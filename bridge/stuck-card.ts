// A lot's card whose agent stalls wakes its orchestrator (ADR 0028's lane). The lead is watched
// (lead.ts); a card's own agent was not: a permission, a modal, a quota or a dead pane left the card
// « en cours » for hours. Hung off `engine.onUpdate`, no timer. The operator hears nothing more: a
// blocked pane already signals (ADR 0011) — this only tells the orchestrator, once per episode.
//
// And any card « en cours » whose agent sat an hour idle, or working on a screen that never moved,
// is asked by the board itself where it is — a command that loops or a background task that never
// returns left cards « en cours » 12–24 h (measured 2026-11: a Bash with no result 10–15 h, a
// background task never back, a hung API call). Escape first when working: it cuts the hung command.
// Once per episode; the operator hears nothing (ADR 0011).

import type { BoardDb } from "./db.ts";
import type { Mux } from "./mux/mux.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { promptAndConfirm } from "./cards.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** How long a card's pane may sit blocked, idle or gone before the orchestrator hears of it. */
export const STUCK_AFTER_MS = 10 * 60_000;
const TAIL_LINES = 15;
/** How long an agent may sit idle, or working on an unchanged screen, before it is asked. Operator's call: 1 h, not 20 min — long builds, short absences. */
export const NUDGE_AFTER_MS = 60 * 60_000;
/** A working pane's screen is read at most this often (throttled here: no timer, no poll loop). */
const READ_EVERY_MS = 5 * 60_000;
const SCREEN_LINES = 40;
export const NUDGE_TEXT = "Où en es-tu ? Si c'est fini, termine la carte.";

export interface Episode {
  /** What the card and its pane looked like when the episode began; any change is the card moving. */
  key: string;
  since: number;
  told: boolean;
}

/** One tick of the rule. `key` null: the card is not stuck (the episode ends, the alarm re-arms). Pure. */
export function stuckStep(prev: Episode | undefined, key: string | null, now: number, after = STUCK_AFTER_MS): { next: Episode | undefined; fire: boolean } {
  if (key === null) return { next: undefined, fire: false };
  if (!prev || prev.key !== key) return { next: { key, since: now, told: false }, fire: false };
  if (prev.told || now - prev.since < after) return { next: prev, fire: false };
  return { next: { ...prev, told: true }, fire: true };
}

/** The pane's state as the rule reads it, or null while its agent works. Pure. */
export function stuckState(status: string | undefined, kind?: "agent" | "shell"): string | null {
  if (status === undefined) return "absent";
  if (kind === "shell") return "shell (agent sorti)";
  return status === "working" ? null : status;
}

/**
 * What of a working screen counts as movement. The agent's spinner line and every digit (elapsed
 * time, token counters, a status line's clock) tick on a hung screen too, so they are dropped. Pure.
 * shortcut: a progress shown only as changing numbers reads as frozen; text or new lines move it.
 */
export function screenPrint(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/esc to interrupt/i.test(l) && !/^\s*[·✢✳✶✻✽*]\s+\S+…/.test(l))
    .join("\n")
    .replace(/\d/g, "");
}

/** The pane as the nudge reads it: `idle`, `working|<screen>`, or null (not a stall, or no screen read yet). Pure. */
export function nudgeState(status: string | undefined, kind: "agent" | "shell" | undefined, print: string | undefined): string | null {
  if (kind === "shell") return null;
  if (status === "idle" || status === "done") return "idle";
  if (status === "working" && print !== undefined) return `working|${print}`;
  return null;
}

/** Pure. */
export function stuckMessage(title: string, cardId: string, state: string, minutes: number, tail: string | null): string {
  return [
    `La carte « ${title} » (${cardId}) est en cours mais son agent ne progresse plus : pane ${state} depuis ${minutes} min.`,
    ...(tail ? ["Fin de son écran :", tail] : []),
    "Débloque-la (réponds à sa question ou sa permission, relance-la) si c'est dans ton mandat ; sinon dis à l'opérateur ce qui coince.",
  ].join("\n");
}

export class StuckCards {
  private readonly episodes = new Map<string, Episode>();
  private readonly nudges = new Map<string, Episode>();
  private readonly screens = new Map<string, { print?: string; readAt: number }>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: Mux,
    private readonly now: () => number = Date.now,
    private readonly after = STUCK_AFTER_MS,
    private readonly nudgeAfter = NUDGE_AFTER_MS,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const now = this.now();
    const panes = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p]));
    const seen = new Set<string>();
    for (const run of this.db.listOpenRuns()) {
      if (!this.db.ownsRun(run)) continue;
      for (const card of this.db.runMembers(run.id)) {
        if (card.status !== "working" && card.status !== "blocked") continue;
        seen.add(card.id);
        const paneId = this.db.openSessionFor(card.id)?.paneId ?? null;
        const pane = paneId ? panes.get(paneId) : undefined;
        const state = stuckState(pane?.status, pane?.kind);
        const { next, fire } = stuckStep(this.episodes.get(card.id), state && `${card.status}|${card.updatedAt}|${paneId}|${state}`, now, this.after);
        if (next) this.episodes.set(card.id, next);
        else this.episodes.delete(card.id);
        if (!fire || !state) continue;
        const orch = findOrchestrator(snap, run.repoPath);
        if (!orch) continue; // nobody to wake; the episode stays told
        const minutes = Math.round((now - next!.since) / 60_000);
        void (pane ? this.herdr.readPane(pane.paneId, "recent", TAIL_LINES, "text").then((r) => r.text.trimEnd(), () => null) : Promise.resolve(null))
          .then((tail) => promptAndConfirm(this.herdr, orch, stuckMessage(card.title, card.id, state, minutes, tail)))
          .catch((err) => console.warn(`[stuck] nudge failed: ${(err as Error).message}`));
      }
    }
    for (const id of [...this.episodes.keys()]) if (!seen.has(id)) this.episodes.delete(id);
    this.nudge(panes, now);
  }

  /** Every card « en cours » with an agent, in a lot or not: ask the agent itself, once per episode. */
  private nudge(panes: Map<string, EngineSnapshot["agents"][number]>, now: number): void {
    const seen = new Set<string>();
    const watched = new Set<string>();
    for (const card of this.db.listCardsWithStatus("working")) {
      const paneId = this.db.openSessionFor(card.id)?.paneId;
      const pane = paneId ? panes.get(paneId) : undefined;
      if (!pane) continue;
      seen.add(card.id);
      if (pane.status === "working") watched.add(pane.paneId);
      const state = nudgeState(pane.status, pane.kind, pane.status === "working" ? this.screen(pane.paneId, now) : undefined);
      const { next, fire } = stuckStep(this.nudges.get(card.id), state && `${card.updatedAt}|${pane.paneId}|${state}`, now, this.nudgeAfter);
      if (next) this.nudges.set(card.id, next);
      else this.nudges.delete(card.id);
      if (!fire) continue;
      const working = pane.status === "working";
      console.log(`[stuck] asking ${pane.paneId} (card ${card.id}, ${working ? "working, screen frozen" : "idle"} 1 h)`);
      void (working ? this.herdr.sendPaneKeys(pane.paneId, ["Escape"]).then(() => this.wait(2000)) : Promise.resolve())
        .then(() => promptAndConfirm(this.herdr, pane.paneId, NUDGE_TEXT, this.wait))
        .catch((err) => console.warn(`[stuck] agent nudge failed: ${(err as Error).message}`));
    }
    for (const id of [...this.nudges.keys()]) if (!seen.has(id)) this.nudges.delete(id);
    for (const id of [...this.screens.keys()]) if (!watched.has(id)) this.screens.delete(id);
  }

  /** The pane's last screen print, re-read in the background at most every READ_EVERY_MS. */
  private screen(paneId: string, now: number): string | undefined {
    const s = this.screens.get(paneId);
    if (!s || now - s.readAt >= READ_EVERY_MS) {
      const entry = { print: s?.print, readAt: now };
      this.screens.set(paneId, entry);
      void this.herdr.readPane(paneId, "recent", SCREEN_LINES, "text").then(
        (r) => void (entry.print = screenPrint(r.text)),
        () => {},
      );
    }
    return s?.print;
  }
}
