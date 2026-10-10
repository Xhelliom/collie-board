// The board wakes its orchestrator (ADR 0028). The orchestrator only moves when the operator speaks;
// when a lot ends, or a card comes back unmerged or blocked, the bridge types one short message into
// its pane — as the run coordinator already does to a worker. No new poll: a journal tailer hung off
// `engine.onUpdate`, cursored in memory like board-notify.ts (a restart replays nothing).

import type { BoardDb, BoardEvent, Card } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { promptAndConfirm } from "./cards.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const FILED = new Set<string>(["done", "archived"]);
const line = (c: Card) => `- « ${c.title} » (${c.id}) : ${c.status}`;

/** The message for a lot that ended: its cards, merged ones apart from those that were ever blocked. Pure. */
export function lotMessage(name: string | null, cards: Card[], blocked: Set<string>, phase?: { name: string; open: Card[] } | null, repoPath?: string): string {
  const ok = cards.filter((c) => FILED.has(c.status) && !blocked.has(c.id));
  const ko = cards.filter((c) => !ok.includes(c));
  return [
    `Le lot « ${name ?? "sans nom"} » est terminé.`,
    ...(ok.length ? ["Mergées :", ...ok.map(line)] : []),
    ...(ko.length ? ["Bloquées ou non mergées :", ...ko.map(line)] : []),
    `Fais à l'opérateur un bilan COURT : ce qui est mergé, ce qui est bloqué et POURQUOI (une raison par carte non mergée, lue dans /api/project/facts?repo=${repoPath ?? "<repo>"} — verdict du lead, gate, review — et dans le journal de la carte), puis la suite que tu proposes.`,
    ...(phase
      ? [
          `C'est aussi la fin de la phase « ${phase.name} » : propose à l'opérateur de la valider (c'est à lui de le faire, pas à toi) et dis où vont les étapes encore ouvertes${phase.open.length ? ` (${phase.open.map((c) => `« ${c.title} »`).join(", ")})` : ""} : phase suivante, backlog ou abandon.`,
        ]
      : []),
    "Ne lance rien et ne valide rien toi-même.",
  ].join("\n");
}

/** The message for one card the lead reports unmerged or blocked. Pure. */
export function cardMessage(card: Card, why: string): string {
  return `La carte « ${card.title} » (${card.id}) n'est pas mergée : ${why}\nDis à l'opérateur ce que tu proposes ; ne relance rien toi-même.`;
}

export class OrchestratorNudger {
  private cursor: number;
  /** `runId:cardId` already reported: the lead may say it twice (unmerged, then halted) — the orchestrator hears it once. */
  private readonly told = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
  ) {
    this.cursor = db.lastEventId();
  }

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    for (const e of this.db.eventsAfter(this.cursor)) {
      this.cursor = e.id;
      const msg = this.messageFor(e);
      if (!msg) continue;
      const paneId = findOrchestrator(snap, msg.repoPath);
      // No living orchestrator: nothing to say to, and nothing to complain about.
      if (paneId) void promptAndConfirm(this.herdr, paneId, msg.text).catch((err) => console.warn(`[orchestrator] nudge failed: ${(err as Error).message}`));
    }
  }

  private messageFor(e: BoardEvent): { repoPath: string; text: string } | null {
    const p = (e.payload ?? {}) as { runId?: string; reason?: string; merged?: boolean };
    const run = p.runId ? this.db.getRun(p.runId) : null;
    if (!run) return null;
    if (e.type === "run.finished") {
      const cards = this.db.runMembers(run.id);
      const blocked = new Set(cards.filter((c) => this.db.listEvents(c.id, 200).some((x) => x.type === "run.halted" && (x.payload as { runId?: string } | null)?.runId === run.id)).map((c) => c.id));
      // End of phase: not yet validated, and every card it groups is filed or sits in this lot.
      const phase = run.phaseId ? this.db.getPhase(run.phaseId) : null;
      const inPhase = phase ? this.db.listCards().filter((c) => c.phaseId === phase.id) : [];
      const ends = phase && phase.closedAt === null && inPhase.every((c) => FILED.has(c.status) || cards.some((m) => m.id === c.id));
      return { repoPath: run.repoPath, text: lotMessage(run.name, cards, blocked, ends && phase ? { name: phase.name, open: inPhase.filter((c) => !FILED.has(c.status)) } : null, run.repoPath) };
    }
    const unmerged = e.type === "run.merge" && p.merged === false;
    if ((!unmerged && e.type !== "run.halted") || !e.cardId) return null;
    const key = `${run.id}:${e.cardId}`;
    const card = this.db.getCard(e.cardId);
    if (!card || this.told.has(key)) return null;
    this.told.add(key);
    return { repoPath: run.repoPath, text: cardMessage(card, p.reason ?? "le lead n'a pas pu la mener au bout") };
  }
}
