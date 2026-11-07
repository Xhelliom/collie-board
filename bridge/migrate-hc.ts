import type { AgentAdapter } from "./adapters.ts";
import type { BoardDb } from "./db.ts";
import type { Mux } from "./mux/mux.ts";
import type { AgentView } from "./types.ts";
import { agentNameFor, launchAgent, outOfSight } from "./cards.ts";
import { ownerOf } from "./mux/composite.ts";

// ─────────────────────────────────────────────────────────────────────────────
// « Migrer vers herdr-core » : a Claude card agent at rest under herdr 0.9 is closed there and
// reopened under hc on the SAME conversation (`claude --resume <id>`, same cwd). Measured in
// HERDR_CORE_API.md §3: the conversation comes back and the session id does not change, so the card's
// transcript, context gauge and agentSessionId follow without remapping.
//
// A bridge that does not read hc yet cannot see the migrated terminal: the session is put out of
// reconcile's sight (`outOfSight`) instead of being orphaned, until its pane shows up in a snapshot —
// then reconcile follows it as any other (cards.ts).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a pane is herdr 0.9's — read off its id by {@link ownerOf}, the composite's one rule. Never
 * `cfg.mux`, which (with both engines read) only names where NEW panes are launched.
 */
export const isHerdr09Pane = (paneId: string): boolean => ownerOf(paneId) === "herdr09";

/** Why the button is not offered. One reason, the first that holds. */
export type MigrateBlock = "not-herdr09" | "no-pane" | "not-claude" | "no-session-id" | "busy" | "hc-down";

/** Whether « Migrer vers herdr-core » may be offered for this pane. Null = yes. */
export function migrateBlock(input: {
  pane: AgentView | undefined;
  adapter: AgentAdapter | undefined;
  hcUp: boolean;
}): MigrateBlock | null {
  if (!input.pane) return "no-pane";
  if (!isHerdr09Pane(input.pane.paneId)) return "not-herdr09";
  if (!input.adapter?.sessionId) return "not-claude";
  if (!input.pane.agentSessionId) return "no-session-id";
  if (input.pane.status !== "idle" && input.pane.status !== "done") return "busy";
  if (!input.hcUp) return "hc-down";
  return null;
}

export type MigrateResult =
  | { ok: true; paneId: string }
  /** hc refused; the agent was brought back under 0.9 on the same conversation. */
  | { ok: false; kind: "fell-back"; paneId: string; message: string }
  /** No spare shell under 0.9: nothing was closed, the agent runs on where it was. */
  | { ok: false; kind: "untouched"; message: string }
  /** Neither engine took it: the pane is gone, the transcript is not (`claude --resume <id>`). */
  | { ok: false; kind: "lost"; message: string };

/**
 * Close the 0.9 pane, then relaunch under hc. Close FIRST: two Claude processes on one session id
 * would both append to its transcript. Any hc failure relaunches under 0.9 with the same resume, in a
 * spare shell opened BEFORE the close — closing a space's last pane closes the space (measured), and
 * a fallback with nowhere to open would lose the agent. No spare, no migration: nothing is touched.
 * The caller has checked {@link migrateBlock}.
 */
export async function migrateToHc(deps: {
  db: BoardDb;
  herdr: Mux;
  hc: Mux;
  sessionId: string;
  pane: AgentView;
  name: string;
  sleep?: (ms: number) => Promise<void>;
}): Promise<MigrateResult> {
  const { db, herdr, hc, sessionId, pane } = deps;
  const session = db.getSession(sessionId)!;
  const resume = ["--resume", pane.agentSessionId!];
  // The cwd already ran Claude, so it is trusted: no trustFolder, no trust screen (measured).
  const name = agentNameFor(deps.name);
  const sleep = deps.sleep;

  let spare: string;
  try {
    spare = (await herdr.createTab(pane.workspaceId, { cwd: pane.cwd, label: name })).paneId;
  } catch (err) {
    return { ok: false, kind: "untouched", message: `herdr 0.9 n'a pas ouvert de shell de secours (${(err as Error).message}) — rien n'a changé` };
  }

  // Between the close and the reattach the pane is missing from the snapshot — not an orphan.
  outOfSight.add(sessionId);
  await herdr.closePane(pane.paneId);

  let hcPane: string | null = null;
  try {
    hcPane = (await hc.createWorkspace({ cwd: pane.cwd, label: name })).paneId;
    await launchAgent(hc, hcPane, "claude", name, sleep, resume);
    db.patchSession(sessionId, { paneId: hcPane });
    db.recordEvent(session.cardId, "session.migrated", { sessionId, from: pane.paneId, to: hcPane, mux: "hc" });
    await herdr.closePane(spare).catch(() => {});
    return { ok: true, paneId: hcPane };
  } catch (err) {
    const message = (err as Error).message;
    if (hcPane) await hc.closePane(hcPane).catch(() => {});
    try {
      await launchAgent(herdr, spare, "claude", name, sleep, resume);
      db.patchSession(sessionId, { paneId: spare });
      db.recordEvent(session.cardId, "session.migrated", { sessionId, from: pane.paneId, to: spare, mux: "herdr09", error: message });
      return { ok: false, kind: "fell-back", paneId: spare, message: `herdr-core a refusé (${message}) — l'agent est relancé sous herdr 0.9` };
    } catch (err2) {
      return { ok: false, kind: "lost", message: `herdr-core (${message}) puis herdr 0.9 (${(err2 as Error).message}) ont refusé — reprendre à la main : claude --resume ${pane.agentSessionId}` };
    } finally {
      outOfSight.delete(sessionId);
    }
  }
}
