// Lost terminals, resumed. Under hc a terminal whose program was lost (reboot, core crash) comes back
// as a plain shell in its last directory and the command is never run again (HERDR_CORE_API.md,
// « Persistance et reprise »). herdr 0.9 relaunched `claude --resume`; this does it for hc, ONCE per
// lost conversation, and only for the agents that were at work:
//
//   resume   — the last turn is open (a prompt or a tool result with no final answer, a tool running),
//              or the turn is closed but nothing says the work is over (card still live, orchestrator).
//   finished — the last turn is closed and the card is in review/done (or a bilan was written), or the
//              agent was `/exit`ed by hand: left alone.
//   asleep   — no message for {@link ASLEEP_MS}: left alone.
//
// Who: a card's open session whose pane is a shell, and a repo's orchestrator (found by its label). The
// lead and the copilot relaunch themselves (copilot.ts `observe`). A free agent has nothing readable
// under hc that says it held a conversation (its terminal keeps only the shell's argv), and a guess by
// directory would resume someone else's: not handled.
//
// Nothing persisted: which conversation is read off the session row or the transcript, which terminal
// was already tried is in memory. One journal event per pass that classified something — the notifier
// turns it into one recap in the herd's slot (board-notify.ts).

import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { agentNameFor, launchAgent } from "./cards.ts";
import type { BoardDb, Card, CardSession } from "./db.ts";
import { BILAN_REL_PATH } from "./lead.ts";
import { ownerOf } from "./mux/composite.ts";
import type { Mux } from "./mux/mux.ts";
import { isOrchestratorAgent, orchestratorName } from "./orchestrator.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { TranscriptSource } from "./transcript.ts";
import type { AgentView } from "./types.ts";

/** No message for this long and the agent is left asleep. ponytail: calibration knob. */
export const ASLEEP_MS = 12 * 60 * 60_000;
/** A pass at most this often — each one may read a few transcripts. */
export const SCAN_EVERY_MS = 30_000;
/** A card whose session opened this recently may be a shell still waiting for its first agent. */
export const LAUNCH_GRACE_MS = 3 * 60_000;
/** The journal type the notifier reads (board-notify.ts). */
export const RESUMED_EVENT = "herd.resumed";

/** The transcript's last turn: whether it is still open, how it ended, when. */
export interface LastTurn {
  open: boolean;
  /** The operator typed `/exit` (or `/quit`): Claude was closed on purpose, not lost. */
  exited: boolean;
  /** The last message's time, ms; null when the log carries none. */
  at: number | null;
}

const COMMAND = /^\s*<command-name>\/?(\w+)<\/command-name>/;

/**
 * Read the last turn of a Claude transcript (jsonl). Pure. Side conversations (subagents) and meta
 * lines are skipped; a local command other than `/exit` is not a turn. Null when no message is found.
 */
export function lastTurn(text: string): LastTurn | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let e: { type?: string; isSidechain?: boolean; isMeta?: boolean; timestamp?: string; message?: { content?: unknown; stop_reason?: string | null } };
    try {
      e = JSON.parse(line);
    } catch {
      continue; // the tail read can clip the first line
    }
    if ((e.type !== "user" && e.type !== "assistant") || e.isSidechain || e.isMeta) continue;
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    const at = Number.isNaN(ts) ? null : ts;
    if (e.type === "assistant") {
      const stop = e.message?.stop_reason;
      return { open: stop !== "end_turn" && stop !== "stop_sequence", exited: false, at };
    }
    const content = e.message?.content;
    const blocks = Array.isArray(content) ? (content as Array<{ type?: string; text?: string }>) : [{ type: "text", text: String(content ?? "") }];
    if (blocks.some((b) => b.type === "tool_result")) return { open: true, exited: false, at };
    const said = blocks.map((b) => b.text ?? "").join("\n");
    const command = COMMAND.exec(said)?.[1];
    if (command === "exit" || command === "quit") return { open: false, exited: true, at };
    if (command || said.trimStart().startsWith("<local-command")) continue;
    // The operator pressed Esc: the turn is theirs to pick up, nothing was running.
    if (said.includes("[Request interrupted by user")) return { open: false, exited: false, at };
    return { open: true, exited: false, at };
  }
  return null;
}

export type ResumeVerdict = "resume" | "finished" | "asleep";

const FINISHED_COLUMNS = new Set(["review", "done", "archived"]);

/** Which of the three a lost agent is. Pure. Finished wins over asleep, asleep over resume. */
export function classify(input: { turn: LastTurn; cardStatus: string | null; bilan: boolean; now: number }): ResumeVerdict {
  const { turn, cardStatus, bilan, now } = input;
  if (turn.exited || bilan || (!turn.open && cardStatus !== null && FINISHED_COLUMNS.has(cardStatus))) return "finished";
  if (turn.at !== null && now - turn.at > ASLEEP_MS) return "asleep";
  return "resume";
}

/** The recap's one line: « 3 agents repris, 2 terminés laissés, 1 endormi laissé ». */
export function recapLine(n: Record<ResumeVerdict, number>): string {
  const s = (k: number) => (k > 1 ? "s" : "");
  const parts = [
    n.resume ? `${n.resume} agent${s(n.resume)} repris` : "",
    n.finished ? `${n.finished} terminé${s(n.finished)} laissé${s(n.finished)}` : "",
    n.asleep ? `${n.asleep} endormi${s(n.asleep)} laissé${s(n.asleep)}` : "",
  ].filter(Boolean);
  return `Terminaux perdus : ${parts.join(", ")}`;
}

/** A lost terminal the board knows a conversation for. */
interface Lost {
  pane: AgentView;
  name: string;
  card: Card | null;
  session: CardSession | null;
}

export class LostAgentResumer {
  /** `paneId|conversation` already classified — the once of « once per lost terminal ». In memory. */
  private readonly seen = new Set<string>();
  private lastScan = 0;
  private busy = false;

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: Mux,
    private readonly source: TranscriptSource,
    /** The orchestrator's agent kind (`boardCopilotKind || boardAgentKind`): only Claude resumes. */
    private readonly orchestratorKind: string,
    private readonly now: () => number = Date.now,
    private readonly wait?: (ms: number) => Promise<void>,
  ) {}

  /** Hung off `engine.onUpdate`; throttled here, one pass in flight. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected" || this.busy || this.now() - this.lastScan < SCAN_EVERY_MS) return;
    this.lastScan = this.now();
    this.busy = true;
    void this.scan(snap)
      .catch((err) => console.warn(`[resume-lost] ${(err as Error).message}`))
      .finally(() => (this.busy = false));
  }

  /** One pass. Exported through the class for the test; returns what it decided. */
  async scan(snap: EngineSnapshot): Promise<Record<ResumeVerdict, string[]>> {
    const out: Record<ResumeVerdict, string[]> = { resume: [], finished: [], asleep: [] };
    for (const pane of snap.shellPanes) {
      if (ownerOf(pane.paneId) !== "hc") continue;
      const lost = this.identify(pane);
      if (!lost) continue;
      const found = await this.conversation(lost);
      if (!found) continue;
      const key = `${pane.paneId}|${found.sessionId}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const bilan = this.bilanSince(pane.cwd, lost.session?.startedAt ?? 0);
      const verdict = classify({ turn: found.turn, cardStatus: lost.card?.status ?? null, bilan, now: this.now() });
      if (verdict === "resume" && !(await this.relaunch(lost, found.sessionId))) continue;
      out[verdict].push(lost.name);
    }
    const total = out.resume.length + out.finished.length + out.asleep.length;
    if (total) {
      const counts = { resume: out.resume.length, finished: out.finished.length, asleep: out.asleep.length };
      this.db.recordEvent(null, RESUMED_EVENT, { ...out, line: recapLine(counts) });
    }
    return out;
  }

  /** A card's open session on this pane, or the repo's orchestrator; null for any other shell. */
  private identify(pane: AgentView): Lost | null {
    const session = this.db.openSessionByPane(pane.paneId);
    if (session) {
      const card = this.db.getCard(session.cardId);
      // A card just started: its shell is waiting for the agent the start is typing, not lost.
      if (!card || (session.agentKind ?? "claude") !== "claude" || this.now() - session.startedAt < LAUNCH_GRACE_MS) return null;
      return { pane, name: card.branch ?? card.title, card, session };
    }
    if (isOrchestratorAgent(pane) && this.orchestratorKind === "claude") return { pane, name: orchestratorName(pane.cwd), card: null, session: null };
    return null;
  }

  /** The conversation the pane held and its last turn. */
  private async conversation(lost: Lost): Promise<{ sessionId: string; turn: LastTurn } | null> {
    const known = lost.session?.agentSessionId;
    // shortcut: without a recorded id, the newest log started in the pane's directory — exact for a
    // card (its own worktree), a guess for an orchestrator sharing the repo with the operator's own
    // sessions. Upgrade if hc ever carries the agent's session id.
    const path = known ? await this.source.resolve(known) : await this.source.resolveByCwd(lost.pane.cwd);
    if (!path) return null;
    const turn = lastTurn((await this.source.load(path)).text);
    if (!turn) return null;
    // Found by directory: a log last written before this session opened is an older conversation.
    if (!known && lost.session && turn.at !== null && turn.at < lost.session.startedAt) return null;
    return { sessionId: known ?? basename(path, ".jsonl"), turn };
  }

  private bilanSince(cwd: string, since: number): boolean {
    const path = join(cwd, BILAN_REL_PATH);
    try {
      return existsSync(path) && statSync(path).mtimeMs >= since;
    } catch {
      return false;
    }
  }

  /** `claude --resume <id>` in the same terminal, through launchAgent. False when it failed (not retried). */
  private async relaunch(lost: Lost, sessionId: string): Promise<boolean> {
    try {
      await launchAgent(this.herdr, lost.pane.paneId, "claude", agentNameFor(lost.name), this.wait, ["--resume", sessionId]);
      if (lost.session) {
        this.db.patchSession(lost.session.id, { agentSessionId: sessionId });
        this.db.recordEvent(lost.session.cardId, "session.resumed", { sessionId: lost.session.id, paneId: lost.pane.paneId, agentSessionId: sessionId });
      }
      return true;
    } catch (err) {
      console.warn(`[resume-lost] ${lost.pane.paneId} (${lost.name}): ${(err as Error).message} — reprendre à la main : claude --resume ${sessionId}`);
      return false;
    }
  }
}
