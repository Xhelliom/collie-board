// The board wakes its orchestrator (ADR 0028). The orchestrator only moves when the operator speaks;
// when a lot ends, or a card comes back unmerged or blocked, the bridge types one short message into
// its pane — as the run coordinator already does to a worker. No new poll: a journal tailer hung off
// `engine.onUpdate`, cursored in memory like board-notify.ts (a restart replays nothing).

import type { BoardDb, BoardEvent, Card } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { promptAndConfirm } from "./cards.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { endOfLot } from "./autonomy.ts";
import type { NotifyLog } from "./notify-log.ts";
import type { PrStatus } from "./git.ts";
import { prStatusFor } from "./integrate.ts";

const FILED = new Set<string>(["done", "archived"]);
const line = (c: Card) => `- « ${c.title} » (${c.id}) : ${c.status}`;

/** The message for a lot that ended: its cards, merged ones (journal, or a PR GitHub says is merged) apart from those that were ever blocked. Pure. */
export function lotMessage(name: string | null, cards: Card[], blocked: Set<string>, merged: Set<string>, phase?: { name: string; open: Card[] } | null, repoPath?: string, auto?: { go: true; next: { id: string; name: string | null } } | { go: false; why: string } | null): string {
  const ok = cards.filter((c) => merged.has(c.id) || (FILED.has(c.status) && !blocked.has(c.id)));
  const ko = cards.filter((c) => !ok.includes(c));
  return [
    `Le lot « ${name ?? "sans nom"} » est terminé.`,
    ...(ok.length ? ["Mergées :", ...ok.map(line)] : []),
    ...(ko.length ? ["Bloquées ou non mergées :", ...ko.map(line)] : []),
    `Fais à l'opérateur un bilan COURT : ce qui est mergé, ce qui est bloqué et POURQUOI (une raison par carte non mergée, lue dans /api/project/facts?repo=${repoPath ?? "<repo>"} — verdict du lead, gate, review — et dans le journal de la carte), puis la suite que tu proposes.`,
    ...(ok.length
      ? [
          `Avant ce bilan, tiens la recette : relis les tests manuels (manualChecks) des cartes mergées — concrets (où cliquer, quoi attendre), regroupés quand ils se font ensemble, rien sur une carte purement interne — et cite « N à tester » (GET /api/recette?repo=${repoPath ?? "<repo>"}).`,
        ]
      : []),
    ...(phase
      ? [
          `C'est aussi la fin de la phase « ${phase.name} » : propose à l'opérateur de la valider (c'est à lui de le faire, pas à toi) et dis où vont les étapes encore ouvertes${phase.open.length ? ` (${phase.open.map((c) => `« ${c.title} »`).join(", ")})` : ""} : phase suivante, backlog ou abandon.`,
        ]
      : []),
    ...(auto?.go
      ? [
          `L'opérateur t'a accordé l'autonomie : tu peux lancer UN lot, le prochain planifié « ${auto.next.name ?? "sans nom"} » (POST /api/runs/${auto.next.id}/launch, avec ton x-collie-pane) — si tu juges le bilan ci-dessus assez bon. Ne valide jamais une phase toi-même.`,
        ]
      : auto
        ? [`Autonomie arrêtée : ${auto.why}. Ne lance rien ; l'opérateur a été prévenu et reprend la main.`, "Ne valide rien toi-même."]
        : ["Ne lance rien et ne valide rien toi-même."]),
  ].join("\n");
}

/** The message for one card the lead reports unmerged or blocked. Pure. */
export function cardMessage(card: Card, why: string): string {
  return `La carte « ${card.title} » (${card.id}) n'est pas mergée : ${why}\nDis à l'opérateur ce que tu proposes ; ne relance rien toi-même.`;
}

/** The message for a phase the operator validated, sealed or reopened. `to`: where its open steps went (null: no phase). Pure. */
export function phaseMessage(kind: "closed" | "sealed" | "reopened", name: string, to: string | null): string {
  if (kind === "reopened")
    return `La phase « ${name} » a été rouverte par l'opérateur. Mets la roadmap et ta note à jour, puis propose ce qu'il reste à y faire.`;
  const where = to ? `la phase « ${to} »` : "le backlog (sans phase)";
  return `La phase « ${name} » a été ${kind === "closed" ? "validée" : "scellée"} par l'opérateur ; les étapes ouvertes sont allées dans ${where}. Mets la roadmap et ta note à jour, puis propose le découpage de la phase suivante.`;
}

export class OrchestratorNudger {
  private cursor: number;
  /** `runId:cardId` already reported: the lead may say it twice (unmerged, then halted) — the orchestrator hears it once. */
  private readonly told = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
    private readonly log?: NotifyLog,
    /** The PR's real state, read when the message is composed — injected so tests need no GitHub. */
    private readonly prState: (card: Card) => Promise<PrStatus | null> = (c) => prStatusFor(c, Date.now, true),
  ) {
    this.cursor = db.lastEventId();
  }

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    for (const e of this.db.eventsAfter(this.cursor)) {
      this.cursor = e.id;
      void this.messageFor(e)
        .then((msg) => {
          if (!msg) return;
          const paneId = findOrchestrator(snap, msg.repoPath);
          // No living orchestrator: nothing to say to, and nothing to complain about.
          if (!paneId) this.db.armAutonomy(msg.repoPath, false); // no orchestrator to be woken: nobody holds the grant
          else return promptAndConfirm(this.herdr, paneId, msg.text);
        })
        .catch((err) => console.warn(`[orchestrator] nudge failed: ${(err as Error).message}`));
    }
  }

  // Sync up to the first await: the `told` guard and cursor stay race-free.
  private async messageFor(e: BoardEvent): Promise<{ repoPath: string; text: string } | null> {
    const p = (e.payload ?? {}) as { runId?: string; reason?: string; merged?: boolean; wait?: boolean; phaseId?: string; moveOpenTo?: string | null };
    // A phase gesture: journaled by project-routes.ts, which refuses an agent pane — so never the orchestrator's own.
    if (e.type === "phase.closed" || e.type === "phase.sealed" || e.type === "phase.reopened") {
      const phase = p.phaseId ? this.db.getPhase(p.phaseId) : null;
      if (!phase) return null;
      const to = p.moveOpenTo ? (this.db.getPhase(p.moveOpenTo)?.name ?? null) : null;
      return { repoPath: phase.repoPath, text: phaseMessage(e.type.slice(6) as "closed" | "sealed" | "reopened", phase.name, to) };
    }
    const run = p.runId ? this.db.getRun(p.runId) : null;
    if (!run) return null;
    if (e.type === "run.finished") {
      const cards = this.db.runMembers(run.id);
      const blocked = new Set(cards.filter((c) => this.db.listEvents(c.id, 200).some((x) => x.type === "run.halted" && (x.payload as { runId?: string } | null)?.runId === run.id)).map((c) => c.id));
      // End of phase: not yet validated, and every card it groups is filed or sits in this lot.
      const phase = run.phaseId ? this.db.getPhase(run.phaseId) : null;
      const inPhase = phase ? this.db.listCards().filter((c) => c.phaseId === phase.id) : [];
      const ends = phase && phase.closedAt === null && inPhase.every((c) => FILED.has(c.status) || cards.some((m) => m.id === c.id));
      // Autonomy (ADR 0030): decided here, once, at the wake — the only place a launch is armed. A bound
      // reached disarms, and the operator hears it on the bell (nothing to retract: it states a stop).
      // The journal only knows the merges the board did; a PR merged by hand is read from GitHub. Unreachable: journal alone.
      const merged = new Set<string>();
      await Promise.all(cards.map(async (c) => {
        try {
          if ((await this.prState(c))?.state === "merged") merged.add(c.id);
        } catch {}
      }));
      const v = endOfLot(this.db, run);
      this.db.armAutonomy(run.repoPath, v.go);
      if (!v.go && v.why) this.log?.add({ cwd: run.repoPath, status: "blocked", subtitle: `orchestrateur arrêté — ${v.why}`, pushed: false });
      const auto = v.go ? v : v.why ? { go: false as const, why: v.why } : null;
      return { repoPath: run.repoPath, text: lotMessage(run.name, cards, blocked, merged, ends && phase ? { name: phase.name, open: inPhase.filter((c) => !FILED.has(c.status)) } : null, run.repoPath, auto) };
    }
    // A wait (`wait: true` — no check registered yet, checks running, mergeability unknown) is not a
    // verdict: the land step asks again and settles it at CHECKS_GRACE_MS. Only a real refusal wakes it.
    const unmerged = e.type === "run.merge" && p.merged === false && !p.wait;
    if ((!unmerged && e.type !== "run.halted") || !e.cardId) return null;
    const key = `${run.id}:${e.cardId}`;
    const card = this.db.getCard(e.cardId);
    if (!card || this.told.has(key)) return null;
    this.told.add(key);
    return { repoPath: run.repoPath, text: cardMessage(card, p.reason ?? "le lead n'a pas pu la mener au bout") };
  }
}
