// A halted lot wakes its orchestrator until somebody resumes it (incident 22/11: the one wake left
// while the orchestrator's pane was being relaunched, and the lot sat halted 25 h). The wake counts as
// delivered only once promptAndConfirm saw it land; it is journaled then (`run.halt_told`, null card),
// and the next one is due when a new halt arrives or REMIND_MS later — read from the journal, so a
// bridge restart re-announces what was never heard and keeps the cadence of what was. Hung off
// engine.onUpdate, throttled here: no timer of its own. No orchestrator: the bell already rang
// (board-notify.ts, ADR 0011), nothing more.

import type { BoardDb, Card, Run } from "./db.ts";
import type { Mux } from "./mux/mux.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { promptAndConfirm } from "./cards.ts";
import { heldHalts } from "./run.ts";
import { resumeAdvice } from "./orchestrator-nudge.ts";

/** A lot still halted is recalled at most this often. */
export const REMIND_MS = 30 * 60_000;
/** How often the open lots are read: a halt is not a 1.5 s matter. */
const SCAN_MS = 30_000;

const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);

/** The wake for a lot halted on `held`. Pure. */
export function haltMessage(run: Run, held: { card: Card; reason: string; ts: number }[]): string {
  const since = Math.min(...held.map((h) => h.ts));
  return [
    `Le lot « ${run.name ?? "sans nom"} » (${run.id}) est arrêté depuis ${hhmm(since)} UTC et personne ne l'a repris :`,
    ...held.map((h) => `- « ${h.card.title} » (${h.card.id}) : ${h.reason}`),
    resumeAdvice(run.id),
  ].join("\n");
}

export class HaltedWaker {
  private lastScan = -Infinity;
  /** Runs whose wake is being typed: a slow confirmation is not sent twice. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: Mux,
    private readonly now: () => number = Date.now,
    private readonly confirm: (herdr: Mux, paneId: string, text: string) => Promise<boolean> = promptAndConfirm,
  ) {}

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const now = this.now();
    if (now - this.lastScan < SCAN_MS) return;
    this.lastScan = now;
    for (const run of this.db.listOpenRuns()) {
      if (this.inFlight.has(run.id)) continue;
      const halts = heldHalts(this.db, run);
      if (!halts.length) continue;
      const told = this.db.lastHaltTold(run.id);
      // Due: never heard, a halt newer than the last hearing, or the reminder's time.
      if (told && halts.every((h) => h.id < told.id) && now - told.ts < REMIND_MS) continue;
      const paneId = findOrchestrator(snap, run.repoPath);
      if (!paneId) continue; // the bell, as for any stop nobody can hear
      // Ready = at rest: a pane being relaunched (unknown) or busy is asked again on a later scan.
      const status = snap.agents.find((a) => a.paneId === paneId)?.status;
      if (status !== "idle" && status !== "done") continue;
      const held = halts.flatMap((h) => {
        const card = h.cardId ? this.db.getCard(h.cardId) : null;
        return card ? [{ card, reason: (h.payload as { reason?: string }).reason ?? "le lead n'a pas pu la mener au bout", ts: h.ts }] : [];
      });
      this.inFlight.add(run.id);
      void this.confirm(this.herdr, paneId, haltMessage(run, held))
        .then((ok) => ok && this.db.recordRunEvent(null, "run.halt_told", { runId: run.id }))
        .catch((err) => console.warn(`[orchestrator] halted-lot wake failed: ${(err as Error).message}`))
        .finally(() => this.inFlight.delete(run.id));
    }
  }
}
