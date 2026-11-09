// A lot's card whose agent stalls wakes its orchestrator (ADR 0028's lane). The lead is watched
// (lead.ts); a card's own agent was not: a permission, a modal, a quota or a dead pane left the card
// « en cours » for hours. Hung off `engine.onUpdate`, no timer. The operator hears nothing more: a
// blocked pane already signals (ADR 0011) — this only tells the orchestrator, once per episode.

import type { BoardDb } from "./db.ts";
import type { Mux } from "./mux/mux.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { promptAndConfirm } from "./cards.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** How long a card's pane may sit blocked, idle or gone before the orchestrator hears of it. */
export const STUCK_AFTER_MS = 10 * 60_000;
const TAIL_LINES = 15;

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

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: Mux,
    private readonly now: () => number = Date.now,
    private readonly after = STUCK_AFTER_MS,
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
  }
}
