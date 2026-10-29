// The run coordinator — ADR 0017, *Who drives it*. Deterministic plumbing: it starts members while a
// slot is free, notices a worker that has landed, hands the lead its question, and executes the
// answer through the routes a tap would use. It decides nothing itself.
//
// NO STATE OF ITS OWN. Where a card is in the loop is read from the card and its journal on every
// snapshot — the newest landing (`card.status` → review) against the newest `run.*` entry — so a
// bridge restart resumes the run from exactly where the cards say it is. The only memory here is
// the set of cards with a question in flight, which is what a restart is allowed to forget.
//
// What it never does: touch a card outside a run, answer a blocked worker (a permission prompt is
// the operator's, as it is today), or move on a disconnected snapshot. It has no timer; it moves
// when `engine.onUpdate` does.

import { join } from "node:path";

import type { AgentAdapter } from "./adapters.ts";
import { COPILOT_DOWN_AFTER, copilotDown, REVIEW_OUTCOMES } from "./board-notify.ts";
import { promptAndConfirm, runningCards, startCard } from "./cards.ts";
import type { Config } from "./config.ts";
import { isAutoHandoffPending, type AgentTemplate, type BoardDb, type BoardEvent, type Card, type CardSession, type Run } from "./db.ts";
import { gatePrompt, parseGate, runGate, type GateResult } from "./gate.ts";
import { baseOf, cardDiffSummary, integrationOf, resolveBase, worktreePathFor } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { askEvery, mergeCard, mergeWhenReady, notePrOutcome, prForCard, prStatusFor, resolveConflict, type MergeGate } from "./integrate.ts";
import { exclusive, integrating } from "./integration-lock.ts";
import { foldIntoLot, lotPrCard, prepareLot } from "./lot.ts";
import { bilanPrompt, BILAN_REL_PATH, Lead, LeadSilent, type CardBrief, type CheckDecision, type ConflictDecision, type TriageDecision } from "./lead.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { advancePipeline, currentStep, nextRole, pipelineOf, sendBackToWorker, workerStep } from "./pipeline.ts";
import { fileAsDone } from "./wrapup.ts";

/** How many times the lead may send a worker back before the card goes to the operator. */
export const MAX_ROUNDS = 5;
const LAND_EVERY_MS = 30_000;

/** The worker's brief when a GitHub check fails on its PR — the counterpart of `gatePrompt`. */
export const ciPrompt = (name: string, log: string): string =>
  [`The GitHub check \`${name}\` failed on your PR. Fix what it reports, commit, and tell me when it should be green.`, "End of its log:", "", log || "(no log available)"].join("\n");

type Outcome = { ok: true } | { ok: false; error: { kind: string; message: string } };

/** Everything the coordinator acts through — the real routes in index.ts, fakes in the tests. */
export interface RunPorts {
  lead: {
    check(input: CardBrief & { statSummary: string; gatePassed?: string; operatorSaid?: string[]; workerReport?: string | null }): Promise<CheckDecision>;
    triage(input: CardBrief & { verdict: string | null; notes: string | null; followUps: { title: string; spec?: string | null }[] }): Promise<TriageDecision>;
    recheckConflict(input: CardBrief & { conflicts: string[] }): Promise<ConflictDecision>;
  };
  /** `startCard`: worktree, `launchAgent`, first prompt. Its own gates still apply. */
  start(cardId: string): Promise<Outcome>;
  /** `promptAndConfirm` to the worker's pane. */
  prompt(paneId: string, text: string): Promise<void>;
  /** ADR 0041, a `lot` run: the lot branch exists and the card will fork from it. Called before each start. */
  prepareLot(run: Run, card: Card): Promise<Outcome>;
  /** ADR 0041: the card's branch into the lot's, locally. "busy": the lot moved under it — ask again next tick. */
  fold(run: Run, card: Card): Promise<Outcome>;
  /** `prForCard` with auto-merge armed — for a `lot` run, the lot's one PR. */
  openPr(card: Card, gate: MergeGate): Promise<Outcome>;
  /** ADR 0043: the repo is set to merge direct — no PR, every card (a lot's too) lands on its own. */
  direct(repoPath: string): boolean;
  /** ADR 0043: `mergeCard` into the base, in the repo's checkout, pushed when there is an origin. "busy": a tap holds the card. */
  mergeDirect(card: Card): Promise<Outcome>;
  /** `mergeWhenReady`: ask again whether the PR's checks let the board merge it (ADR 0029). "busy": a gesture holds the card (integration-lock.ts) — not asked, ask again next tick. */
  land(card: Card, gate: MergeGate): Promise<void | "busy">;
  /** Ask GitHub, fresh, what a card's PR became and journal it (`notePrOutcome`): a merge, a close, or nothing. */
  refreshPr(card: Card): Promise<void>;
  /** `resolveConflict` against origin's base, to the card's own agent — `withLot`: against the lot's local branch (ADR 0041). */
  resolveConflict(card: Card, withLot?: true): Promise<Outcome>;
  /** `fileAsDone`: close the session, file the card, ask for the wrapup. */
  fileAsDone(card: Card): void;
  /** What the lead reads: the worker's checkout and its base. Null when there is no checkout. */
  brief(card: Card): Promise<CardBrief | null>;
  stat(cardId: string): Promise<string>;
  /** The worker's closing bilan from its checkout, or null when it left none. */
  report(worktree: string): Promise<string | null>;
  /** How many more agents may start now (`db.maxAgents() ?? cfg.boardMaxAgents` minus running; 0 = no limit). */
  freeSlots(): number;
  /** The repo's gate command (ADR 0020), or null. Read per card: the operator may set it mid-run. */
  gateCommand(card: Card): string | null;
  /** Run it in the worker's checkout. */
  runGate(command: string, worktree: string): Promise<GateResult>;
  /** Whether the copilot reviews — off, or down (`copilotDown`: no member waits on a review that will
   *  time out like the last ones), there is no review to triage and the lead goes straight to the PR. */
  reviewing(): boolean;
  /** Commits the card's branch has over its base; null when it cannot be told (never blocks). */
  commits(card: Card): Promise<number | null>;
  /** The tail of the worker's pane: its last word, for the operator. */
  lastReply(paneId: string): Promise<string>;
  /** ADR 0031: swap the card's session for a fresh agent in its next pipeline role. */
  advance(card: Card, role: AgentTemplate, report: string | null): Promise<void>;
  /** ADR 0031: a send-back about the code goes back to the worker role at `index`, in a fresh session. */
  sendBack(card: Card, failure: string, index: number): Promise<void>;
}

/** What a member needs next, read from the card, its journal and its pane. Null: nothing, for now. */
export type Step =
  | { kind: "start" }
  | { kind: "predecessor" }
  | { kind: "gate" }
  | { kind: "check" }
  | { kind: "recheck"; conflicts: string[] }
  | { kind: "triage"; sessionId: string }
  | { kind: "advance"; role: AgentTemplate }
  | { kind: "fold" }
  | { kind: "pr" }
  | { kind: "land" }
  | { kind: "file" }
  | { kind: "halt"; reason: string; limit?: true }
  | null;

const STARTABLE = new Set<string>(["backlog", "ready"]);
const FILED = new Set<string>(["done", "archived"]);

/** What the operator told the worker since the lead's last verdict on this run, oldest first. Pure. */
export function operatorSince(events: BoardEvent[], runId: string): string[] {
  const verdict = events.find((e) => e.type === "run.decision" && isRun(e, runId) && isVerdict(e));
  return events
    .filter((e) => e.type === "card.operator_said" && (e.id ?? 0) > (verdict?.id ?? 0))
    .map((e) => String((e.payload as { text?: unknown } | null)?.text ?? ""))
    .filter(Boolean)
    .reverse();
}

const isRun = (e: BoardEvent, runId: string) =>
  e.type.startsWith("run.") && (e.payload as { runId?: string } | null)?.runId === runId;

/** The newest entry matching, from a journal listed newest first. */
const newest = (events: BoardEvent[], match: (e: BoardEvent) => boolean) => events.find(match) ?? null;
const after = (a: BoardEvent | null, b: BoardEvent | null) => (a?.id ?? 0) > (b?.id ?? 0);

/**
 * Where one member stands. Pure over what the db and the snapshot hold, so the whole grammar —
 * rounds, halt, the order of check → triage → PR → file — is testable without a herd.
 */
export function stepFor(
  run: Run,
  card: Card,
  /** The card's journal, newest first. */
  events: BoardEvent[],
  ctx: {
    session: CardSession | null;
    /** The worker pane's status in the snapshot. */
    pane: string | undefined;
    /** Its predecessor is filed (or it has none). */
    depsDone: boolean;
    /** …but filed on an armed auto-merge nobody has seen land yet ({@link awaitsMerge}). */
    predecessorArmed?: boolean;
    /** The repo has a gate: a landing is run through it before the lead sees it. */
    gated: boolean;
    reviewing: boolean;
    /** The copilot's review of the open session: there, failed, or still to come. */
    review: "done" | "failed" | "pending";
    /** The next role of the card's pipeline (ADR 0031), or null on its last step. */
    next?: AgentTemplate | null;
    /** A `lot` run (ADR 0041): every other card of the lot is filed — this one opens, and waits on, the lot's PR. */
    closer?: boolean;
  },
): Step {
  const halted = newest(events, (e) => e.type === "run.halted" && isRun(e, run.id));
  const held = holding(events, run.id);
  const landed = newest(events, (e) => e.type === "card.status" && (e.payload as { to?: string }).to === "review");

  if (STARTABLE.has(card.status)) {
    // A halt on a card never started (its start failed) holds until the operator moves it, or resumes the run.
    if (held) return null;
    if (!ctx.depsDone) return null;
    // ADR 0036: started now, it would fork from — and open its PR against — a branch not merged yet.
    return ctx.predecessorArmed ? { kind: "predecessor" } : { kind: "start" };
  }
  // Only a worker that has landed and sits quietly. `blocked` is a question — never ours to answer.
  if (card.status !== "review" || (ctx.pane !== "idle" && ctx.pane !== "done")) return null;
  // Busy with the board's own handoff or wrapup ask.
  if (!ctx.session || ctx.session.handoffRequestedAt !== null || isAutoHandoffPending(ctx.session)) return null;
  // Halted since this landing: the operator's until the worker lands again, or the run is resumed —
  // which picks up at the step that halted (a triage asked again, not the worker). An infra halt
  // keeps asking GitHub: once the check is green again, the PR merges and the card is filed.
  if (after(held, landed)) {
    if (!infraHeld(events, run.id)) return null;
    const pr = newest(events, (e) => e.type === "card.pr_opened" || e.type === "card.pr_updated");
    return after(landing(events), pr) ? { kind: "file" } : { kind: "land" };
  }

  const decision = newest(events, (e) => e.type === "run.decision" && isRun(e, run.id) && isVerdict(e));
  const resolve = newest(events, (e) => e.type === "card.resolve_requested");

  if (!after(decision, landed)) {
    // A landing nobody has judged yet. Rounds count since the last halt: the operator acting on one
    // starts the count again.
    const rounds = events.filter(
      (e) => e.type === "run.decision" && isRun(e, run.id) && after(e, halted) && (e.payload as { decision: string }).decision === "prompt",
    ).length;
    if (rounds >= MAX_ROUNDS) return { kind: "halt", reason: `${rounds} rounds without the lead finding it finished`, limit: true };
    if (after(resolve, decision)) {
      const clash = newest(events, (e) => e.type === "card.pr_failed" && (e.payload as { stage?: string }).stage === "conflict");
      return { kind: "recheck", conflicts: ((clash?.payload as { files?: string[] } | null)?.files) ?? [] };
    }
    // Machine first (ADR 0020): the lead reads only what the gate passed, on THIS landing.
    if (ctx.gated && !after(newest(events, (e) => e.type === "run.gate" && isRun(e, run.id)), landed)) return { kind: "gate" };
    return { kind: "check" };
  }
  // The worker was sent back and has not picked it up yet.
  if ((decision!.payload as { decision: string }).decision !== "finished") return null;
  // The conflict went to the worker; its next landing is a recheck, not this.
  if (after(resolve, decision)) return null;
  // ADR 0031: the lead found this step finished; the next role takes the branch before it is reviewed and integrated.
  if (ctx.next) return { kind: "advance", role: ctx.next };

  if (ctx.reviewing && !events.some((e) => e.type === "run.triaged" && isRun(e, run.id))) {
    if (ctx.review === "pending") return null;
    if (ctx.review === "done") return { kind: "triage", sessionId: ctx.session.id };
  }
  const pr = newest(events, (e) => e.type === "card.pr_opened" || e.type === "card.pr_updated");
  // ADR 0041: a card of a one-PR lot lands in the lot branch first. Only the last one to land has a PR to open.
  if (run.integration === "lot") {
    if (!after(newest(events, (e) => e.type === "card.lot_merged"), decision)) return { kind: "fold" };
    if (!ctx.closer && !after(pr, decision)) return { kind: "file" };
  }
  // INTEGRATE FIRST, FILE SECOND — as the route does: filing ends the session that could settle a conflict.
  if (!after(pr, decision)) return { kind: "pr" };
  // Filed once landed, nothing less (ADR 0036): merged, or GitHub's auto-merge armed. Until then the
  // land step asks GitHub again — a wait is answered later, a refusal halts or goes back (`landed`).
  return after(landing(events), pr) ? { kind: "file" } : { kind: "land" };
}

/** The newest proof a PR has landed or will: merged, or GitHub's auto-merge armed (ADR 0017 step 7). */
const landing = (events: BoardEvent[]) => newest(events, (e) => e.type === "card.pr_merged" || e.type === "card.automerge_armed");

/**
 * A card filed on GitHub's auto-merge ARMED, whose merge nobody has journaled yet: its newest PR word
 * is the arming. Its successor must not start before the board has seen the merge (ADR 0036). Pure.
 */
export const awaitsMerge = (events: BoardEvent[]): boolean => newest(events, (e) => PR_WORDS.has(e.type))?.type === "card.automerge_armed";
const PR_WORDS = new Set(["card.automerge_armed", "card.pr_opened", "card.pr_updated", "card.pr_merged", "card.pr_closed", "card.merged"]);

/** A check or re-check answer — the ones that move the card, not a triaged follow-up's. */
const isVerdict = (e: BoardEvent) => {
  const d = (e.payload as { decision?: string }).decision;
  return d === "finished" || d === "prompt";
};

/** The halt that still holds on a card: its newest, unless the operator resumed the run after it. Pure. */
const holding = (events: BoardEvent[], runId: string) => {
  const halted = newest(events, (e) => e.type === "run.halted" && isRun(e, runId));
  return after(newest(events, (e) => e.type === "run.resumed" && isRun(e, runId)), halted) ? null : halted;
};

/**
 * The halt still holding on a card when it is an infra one — a red check the worker found nothing to
 * fix in the code for (`run.halted` with `infra`). Its card is not moved after it. Pure.
 */
export function infraHeld(events: BoardEvent[], runId: string): BoardEvent | null {
  const held = holding(events, runId);
  if (!(held?.payload as { infra?: boolean } | undefined)?.infra) return null;
  return after(newest(events, (e) => e.type === "card.status"), held) ? null : held;
}

/** ADR 0041: the card's branch is in its lot's — measured against the lot, a card with nothing new looks empty. */
const folded = (events: BoardEvent[], runId: string) =>
  events.some((e) => e.type === "card.lot_merged" && (e.payload as { runId?: string } | null)?.runId === runId);

/**
 * The operator resumes a halted run: each member still held gets a `run.resumed`, and the next tick
 * picks it up where it stopped — a halted triage is asked again, the worker is not. Returns how many
 * cards it lifted; 0 means nothing was halted.
 */
export function resumeRun(db: BoardDb, run: Run): number {
  const held = db.runMembers(run.id).filter((c) => stuck(run, c, db.listEvents(c.id, 200)));
  for (const c of held) db.recordRunEvent(c.id, "run.resumed", { runId: run.id });
  return held.length;
}

/** A run's readable state (ADR 0017, *How a run ends*). Pure over the members and their journals. */
export function runState(run: Run, members: { card: Card; events: BoardEvent[] }[]): "finished" | "halted" | "running" {
  if (members.every((m) => FILED.has(m.card.status))) return "finished";
  return members.some(({ card, events }) => stuck(run, card, events)) ? "halted" : "running";
}

/** Why a run is halted: the newest halt still holding on a member, or null. Pure. */
export function haltReason(run: Run, members: { card: Card; events: BoardEvent[] }[]): string | null {
  let held: BoardEvent | null = null;
  for (const { card, events } of members) {
    if (!stuck(run, card, events)) continue;
    const h = holding(events, run.id)!;
    if (!held || h.ts > held.ts) held = h;
  }
  return held ? String((held.payload as { reason?: unknown }).reason ?? "") : null;
}

/** A member waiting on the operator. A halt holds until the card moves after it, or the run is resumed — the operator acting on it. */
function stuck(run: Run, card: Card, events: BoardEvent[]): boolean {
  if (FILED.has(card.status)) return false;
  const halted = holding(events, run.id);
  return halted !== null && !after(newest(events, (e) => e.type === "card.status"), halted);
}

export class RunCoordinator {
  /** Cards with an action in flight, so a 1.5 s tick doesn't ask twice. Memory a restart may lose. */
  private readonly busy = new Set<string>();
  /** When each card's PR checks were last asked about (ADR 0029). */
  private readonly landAsked = new Map<string, number>();
  /** Starts in flight: they hold a slot before their session exists. */
  private starting = 0;
  /** …and per run, for a lot's own parallelism ceiling. */
  private readonly startingBy = new Map<string, number>();
  /** Lots with a fold, a filing or a PR in flight: who closes a one-PR lot is read from who is filed, so those go one at a time. */
  private readonly lotBusy = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly ports: RunPorts,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called on every snapshot. Never throws. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const panes = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p.status as string]));
    const reviewing = this.ports.reviewing();

    for (const open of this.db.listOpenRuns()) {
      // ADR 0048 §7: another pair's lot is that pair's coordinator's to drive — seen here, never driven.
      if (!this.db.ownsRun(open)) continue;
      // ADR 0043: merged direct, a lot has no PR to share — each card lands as a card of its own.
      const run: Run = this.ports.direct(open.repoPath) ? { ...open, integration: "card" } : open;
      const members = this.db.runMembers(run.id).map((card) => ({ card, events: this.db.listEvents(card.id, 200) }));
      if (members.length === 0) continue;
      if (runState(run, members) === "finished") {
        this.db.recordRunEvent(null, "run.finished", { runId: run.id });
        continue;
      }
      let slots = this.ports.freeSlots() - this.starting;
      // A lot may be capped below the board (1 = one card at a time): the planner knows which cards
      // touch the same files. Running = members with a live session, plus starts still in flight.
      if (run.maxParallel !== null) {
        const running = members.filter((m) => !FILED.has(m.card.status) && this.db.openSessionFor(m.card.id)).length;
        slots = Math.min(slots, run.maxParallel - running - (this.startingBy.get(run.id) ?? 0));
      }
      for (const { card, events } of members) {
        if (this.busy.has(card.id)) continue;
        const session = this.db.openSessionFor(card.id);
        const pred = card.dependsOn ? this.db.getCard(card.dependsOn) : null;
        const reviews = session ? this.db.listReviews(card.id).filter((r) => r.sessionId === session.id) : [];
        const failed = session && events.some((e) => e.type === "copilot.review_failed" && (e.payload as { sessionId?: string }).sessionId === session.id);
        const step = stepFor(run, card, events, {
          session,
          pane: session?.paneId ? panes.get(session.paneId) : undefined,
          depsDone: !pred || FILED.has(pred.status),
          predecessorArmed: pred !== null && FILED.has(pred.status) && awaitsMerge(this.db.listEvents(pred.id, 200)),
          gated: this.ports.gateCommand(card) !== null,
          reviewing,
          review: reviews.length ? "done" : failed ? "failed" : "pending",
          next: nextRole(pipelineOf(this.db, card), events),
          closer: run.integration === "lot" && members.every((m) => m.card.id === card.id || FILED.has(m.card.status)),
        });
        if (!step) continue;
        const serial = run.integration === "lot" && (step.kind === "fold" || step.kind === "file" || step.kind === "pr");
        if (serial && this.lotBusy.has(run.id)) continue;
        const start = step.kind === "start";
        if (start) {
          if (slots <= 0) continue;
          slots--;
          this.starting++;
          this.startingBy.set(run.id, (this.startingBy.get(run.id) ?? 0) + 1);
        }
        this.busy.add(card.id);
        if (serial) this.lotBusy.add(run.id);
        void this.act(run, card, session, step)
          .catch((err) => this.halt(run, card.id, (err as Error).message, err instanceof LeadSilent ? { leadSilent: true, ...(err.paneId && { paneId: err.paneId }) } : {}))
          .finally(() => {
            this.busy.delete(card.id);
            if (serial) this.lotBusy.delete(run.id);
            if (start) {
              this.starting--;
              this.startingBy.set(run.id, (this.startingBy.get(run.id) ?? 1) - 1);
            }
          });
      }
    }
  }

  private async act(run: Run, card: Card, session: CardSession | null, step: NonNullable<Step>): Promise<void> {
    const runId = run.id;
    switch (step.kind) {
      case "halt":
        { if (step.limit) await this.haltEmpty(run, card, session, step.reason); else this.halt(run, card.id, step.reason); return; }
      case "start": {
        if (run.integration === "lot") {
          const lot = await this.ports.prepareLot(run, card);
          if (!lot.ok) return this.halt(run, card.id, `lot branch: ${lot.error.message}`);
        }
        const r = await this.ports.start(card.id);
        // `busy` / `blocked-by` are the gates racing a tick; anything else would fail again every tick.
        if (!r.ok && r.error.kind !== "busy" && r.error.kind !== "blocked-by") this.halt(run, card.id, `start failed: ${r.error.message}`);
        return;
      }
      case "gate":
        return this.gate(run, card, session!);
      case "check":
      case "recheck": {
        if (step.kind === "check" && (await this.infra(run, card))) return;
        const brief = await this.ports.brief(card);
        if (!brief) return this.halt(run, card.id, "the worker's checkout is gone");
        const gatePassed = this.ports.gateCommand(card) ?? undefined;
        const operatorSaid = operatorSince(this.db.listEvents(card.id, 200), run.id);
        const statSummary = step.kind === "check" ? await this.ports.stat(card.id) : "";
        const workerReport = step.kind === "check" ? await this.ports.report(brief.worktree) : null;
        // Nothing to judge and nothing said: the lead would only send it back (ADR 0014's loop), so ask for the bilan.
        if (step.kind === "check" && statSummary.trim() === "(no changes)" && !workerReport) {
          await this.ports.prompt(session!.paneId!, `Your branch has no changes. ${bilanPrompt()}`);
          this.db.recordRunEvent(card.id, "run.decision", { runId, decision: "prompt", prompt: "bilan", reason: "empty diff and no bilan from the worker" });
          return;
        }
        const d =
          step.kind === "check"
            ? await this.ports.lead.check({ ...brief, statSummary, gatePassed, operatorSaid, workerReport })
            : await this.ports.lead.recheckConflict({ ...brief, conflicts: step.conflicts });
        if (d.decision === "halt") return this.halt(run, card.id, d.reason);
        if (d.decision === "prompt") {
          await this.sendFailure(card, session!, d.prompt);
          this.db.recordRunEvent(card.id, "run.decision", { runId, decision: "prompt", prompt: d.prompt, reason: d.reason });
          return;
        }
        if (await this.haltEmpty(run, card, session, d.reason, true)) return;
        this.db.recordRunEvent(card.id, "run.decision", { runId, decision: "finished", reason: d.reason });
        return;
      }
      case "advance": {
        const brief = await this.ports.brief(card);
        const report = brief ? await this.ports.report(brief.worktree) : null;
        await this.ports.advance(card, step.role, report);
        return;
      }
      case "triage":
        return this.triage(run, card, step.sessionId);
      case "fold": {
        const r = await this.ports.fold(run, card);
        if (r.ok) return void this.db.recordEvent(card.id, "card.lot_merged", { runId, lot: this.db.getRun(runId)?.lotBranch });
        if (r.error.kind === "busy") return;
        if (r.error.kind !== "conflict") return this.halt(run, card.id, `lot merge: ${r.error.message}`);
        const settled = await this.ports.resolveConflict(card, true);
        if (!settled.ok) this.halt(run, card.id, `conflict not handed over: ${settled.error.message}`);
        return;
      }
      case "pr": {
        if (this.ports.direct(run.repoPath)) return this.mergeDirect(run, card);
        const r = await this.ports.openPr(card, this.mergeGate(run, card));
        if (r.ok) return this.landed(run, card, session!);
        if (r.error.kind !== "conflict") return this.halt(run, card.id, `PR: ${r.error.message}`);
        const settled = await this.ports.resolveConflict(card);
        if (!settled.ok) this.halt(run, card.id, `conflict not handed over: ${settled.error.message}`);
        return;
      }
      case "predecessor":
        return this.awaitPredecessor(run, card);
      case "land": {
        // Throttled in memory: the tick is 1.5 s, GitHub's checks take minutes.
        // An infra halt waits on a human fixing the runner: slow down the longer it waits.
        const infra = infraHeld(this.db.listEvents(card.id, 200), runId);
        const every = infra ? askEvery(this.now() - infra.ts) : LAND_EVERY_MS;
        if (this.now() - (this.landAsked.get(card.id) ?? 0) < every) return;
        this.landAsked.set(card.id, this.now());
        if ((await this.ports.land(card, this.mergeGate(run, card))) === "busy") {
          this.landAsked.delete(card.id); // nothing asked: the next tick asks
          return;
        }
        return this.landed(run, card, session!);
      }
      case "file":
        return this.ports.fileAsDone(card);
    }
  }

  /**
   * ADR 0036: the predecessor was filed on GitHub's auto-merge armed, and nobody has seen the merge.
   * Ask GitHub (at the land step's pace) through `notePrOutcome`: merged — journaled, its dependents
   * rebound, and the next tick starts this card from its base (ADR 0034); closed — its work will not
   * land, the operator's call; still open — wait, said once on this card.
   */
  private async awaitPredecessor(run: Run, card: Card): Promise<void> {
    const said = this.db.listEvents(card.id, 200).find((e) => e.type === "run.decision" && isRun(e, run.id) && (e.payload as { decision?: string }).decision === "wait");
    // An auto-merge whose checks went red never merges: slow down the longer it waits.
    const every = said ? askEvery(this.now() - said.ts) : LAND_EVERY_MS;
    if (this.now() - (this.landAsked.get(card.id) ?? 0) < every) return;
    this.landAsked.set(card.id, this.now());
    const pred = this.db.getCard(card.dependsOn!)!;
    await this.ports.refreshPr(pred);
    const word = newest(this.db.listEvents(pred.id, 200), (e) => PR_WORDS.has(e.type));
    if (word?.type === "card.pr_closed") return this.halt(run, card.id, `“${pred.title}”'s PR was closed without merging — its work is not in the base`);
    if (word?.type !== "card.automerge_armed") return;
    if (!said) {
      this.db.recordRunEvent(card.id, "run.decision", {
        runId: run.id,
        decision: "wait",
        reason: `waiting for “${pred.title}”'s PR to merge (auto-merge armed) — started now, this card would fork from its unmerged branch`,
      });
    }
  }

  /**
   * ADR 0043: the lead said finished, the gate must be green, then the card's branch goes into the base
   * in the repo's checkout. Merged (and pushed, with an origin): filed. A conflict: to the worker, against
   * the local base. Any refusal — a dirty checkout, not on the base, origin ahead, a push refused — halts
   * with its reason, the card where it was and nothing overwritten.
   */
  private async mergeDirect(run: Run, card: Card): Promise<void> {
    const gate = this.mergeGate(run, card);
    if (!gate.ok) return this.halt(run, card.id, `merge direct: ${gate.why}`);
    const r = await this.ports.mergeDirect(card);
    if (r.ok) return this.ports.fileAsDone(this.db.getCard(card.id)!);
    if (r.error.kind === "busy") return;
    if (r.error.kind !== "conflict") return this.halt(run, card.id, `merge direct: ${r.error.message}`);
    const settled = await this.ports.resolveConflict(card);
    if (!settled.ok) this.halt(run, card.id, `conflict not handed over: ${settled.error.message}`);
  }

  /** ADR 0027: the board merges only what the gate passed on this run. No gate set = the lead's word alone. */
  private mergeGate(run: Run, card: Card): MergeGate {
    const command = this.ports.gateCommand(card);
    const verdict = newest(this.db.listEvents(card.id), (e) => e.type === "run.gate" && isRun(e, run.id));
    const ok = !command || (verdict?.payload as { ok?: boolean } | undefined)?.ok === true;
    return {
      runId: run.id,
      ok,
      why: !command ? "no gate set" : ok ? "gate green" : verdict ? "the gate is red — not merging" : "the gate never ran — not merging",
    };
  }

  /**
   * What the PR just did. Merged, or auto-merge armed — the card is filed. GitHub has not answered
   * (checks running, mergeability unknown) — nothing, the next tick asks again (ADR 0036). A check red
   * — back to the worker with its log, a round like a red gate (ADR 0029). A conflict — to the
   * worker's agent, against origin's base (ADR 0014). Anything else the board refused to merge — the
   * operator's: the card is halted, never filed with its PR open (ADR 0035).
   */
  private async landed(run: Run, card: Card, session: CardSession): Promise<void> {
    const events = this.db.listEvents(card.id, 200);
    const pr = newest(events, (e) => e.type === "card.pr_opened" || e.type === "card.pr_updated");
    if (after(landing(events), pr)) return this.ports.fileAsDone(this.db.getCard(card.id)!);
    const merge = newest(events, (e) => e.type === "run.merge" && isRun(e, run.id));
    if (!after(merge, pr)) return;
    const p = merge!.payload as { wait?: boolean; reason?: string; conflict?: boolean; ci?: { name: string; log: string } };
    if (p.wait) return;
    if (p.ci) {
      // Still red under an infra halt: the worker already found nothing to fix — wait for green.
      if (infraHeld(events, run.id)) return;
      const prompt = ciPrompt(p.ci.name, p.ci.log);
      await this.sendFailure(card, session, prompt);
      this.db.recordRunEvent(card.id, "run.decision", { runId: run.id, decision: "prompt", prompt, ci: p.ci.name, reason: `the check ${p.ci.name} failed on GitHub` });
      return;
    }
    if (p.conflict) {
      const settled = await this.ports.resolveConflict(card);
      if (!settled.ok) this.halt(run, card.id, `conflict not handed over: ${settled.error.message}`);
      return;
    }
    this.halt(run, card.id, `PR not merged: ${p.reason ?? "no reason given"}`);
  }

  /**
   * Step 3, machine first: red goes straight back to the worker with the gate's own report — no lead
   * asked, no quota spent — and counts as a round, so MAX_ROUNDS is the escalation to the operator.
   * A gate that cannot give a verdict is not the worker's fault: it halts.
   */
  private async gate(run: Run, card: Card, session: CardSession): Promise<void> {
    const command = this.ports.gateCommand(card);
    const brief = await this.ports.brief(card);
    if (!command || !brief) return this.halt(run, card.id, command ? "the worker's checkout is gone" : "the gate was removed");
    const r = await this.ports.runGate(command, brief.worktree);
    if (r.kind === "error") return this.halt(run, card.id, `gate could not run: ${r.message}`);
    const ok = r.kind === "pass";
    this.db.recordRunEvent(card.id, "run.gate", { runId: run.id, command, ok, ...(ok ? {} : { summary: r.summary }) });
    if (ok) return;
    const prompt = gatePrompt(command, r.summary);
    await this.sendFailure(card, session, prompt);
    this.db.recordRunEvent(card.id, "run.decision", { runId: run.id, decision: "prompt", prompt, reason: `the gate failed (exit ${r.exit})` });
  }

  /** Step 5: the lead reads the review with the code; each follow-up card is kept, folded or dropped. */
  private async triage(run: Run, card: Card, sessionId: string): Promise<void> {
    const review = this.db.listReviews(card.id).find((r) => r.sessionId === sessionId)!;
    // Only a follow-up still exactly as the review filed it: one the operator has started or moved is theirs.
    const followUps = review.todos
      .map((t) => (t.cardId ? this.db.getCard(t.cardId) : null))
      .filter((c): c is Card => c !== null && c.status === "backlog" && c.runId === null);
    const brief = await this.ports.brief(card);
    if (!brief) return this.halt(run, card.id, "the worker's checkout is gone");
    const d = await this.ports.lead.triage({
      ...brief,
      verdict: review.verdict,
      notes: review.notes,
      followUps: followUps.map((f) => ({ title: f.title, spec: f.spec })),
    });

    let folded = this.db.runMembers(run.id).filter((c) =>
      this.db.listEvents(c.id, 200).some((e) => e.type === "run.decision" && isRun(e, run.id) && (e.payload as { decision: string }).decision === "fold"),
    ).length;
    for (const f of d.followUps) {
      const fu = followUps[f.index]!;
      if (f.action === "drop") {
        this.db.deleteCard(fu.id);
        this.db.recordRunEvent(card.id, "run.decision", { runId: run.id, decision: "drop", followUp: fu.title, reason: f.reason });
      } else if (f.action === "fold" && folded < run.foldInCap) {
        folded++;
        this.db.joinRun(fu.id, run.id);
        this.db.recordRunEvent(fu.id, "run.decision", { runId: run.id, decision: "fold", reason: f.reason });
      } else {
        // Past the cap a fold is a card for later — ADR 0017, *What this rules out*.
        const reason = f.action === "fold" ? `fold-in cap (${run.foldInCap}) reached — ${f.reason}` : f.reason;
        this.db.recordRunEvent(fu.id, "run.decision", { runId: run.id, decision: "keep", reason });
      }
    }
    this.db.recordRunEvent(card.id, "run.triaged", { runId: run.id, verdict: review.verdict, ...d.verdict });
  }

  /**
   * A code card whose branch holds no commit is not finished, however the lead or the round count
   * put it: the operator gets the lead's reason and the worker's last word. An explore card ships a
   * conclusion, not commits, and an unknown count never blocks. Returns whether it halted;
   * `onlyEmpty` false (the round limit) halts regardless, just without the detail on a card with code.
   */
  private async haltEmpty(run: Run, card: Card, session: CardSession | null, leadReason: string, onlyEmpty = false): Promise<boolean> {
    // A card folded into its lot has delivered: against the lot's branch it can only measure empty.
    const empty = card.category !== "explore" && !folded(this.db.listEvents(card.id, 200), run.id) && (await this.ports.commits(card)) === 0;
    if (!empty) {
      if (!onlyEmpty) this.halt(run, card.id, leadReason);
      return false;
    }
    const lastPrompt = this.db.listEvents(card.id, 200).find((e) => e.type === "run.decision" && isRun(e, run.id) && (e.payload as { decision: string }).decision === "prompt");
    const lead = onlyEmpty ? leadReason : ((lastPrompt?.payload as { reason?: string } | undefined)?.reason ?? "");
    const reply = session?.paneId ? (await this.ports.lastReply(session.paneId).catch(() => "")).trim() : "";
    this.halt(
      run,
      card.id,
      `${onlyEmpty ? "the lead called it finished" : leadReason}, yet the branch has no commit. Lead: ${lead || "(no reason)"}. Worker's last reply: ${reply || "(none)"}`,
    );
    return true;
  }

  /**
   * A send-back about the code (red gate, red CI, the lead's own correction) goes to whoever wrote it: the
   * card's session while it is on a worker role (or the pipeline has none), the nearest earlier worker
   * once a later role (the reviewer) has taken over (ADR 0031). Asking for a missing bilan stays with
   * the session that owes it.
   */
  private async sendFailure(card: Card, session: CardSession, failure: string): Promise<void> {
    const current = currentStep(this.db.listEvents(card.id, 200));
    const worker = workerStep(pipelineOf(this.db, card), current);
    if (worker !== null && worker !== current) await this.ports.sendBack(card, failure, worker);
    else await this.ports.prompt(session.paneId!, failure);
  }

  /**
   * A card of a one-PR lot, already folded, sent back for a red check, lands with nothing new over the
   * lot: the worker found nothing to fix in the code. Not the code, not a round — the runner, the
   * operator's (ADR 0041). Halted as infra, the land step keeps asking GitHub. Returns whether it halted.
   */
  private async infra(run: Run, card: Card): Promise<boolean> {
    const events = this.db.listEvents(card.id, 200);
    const verdict = newest(events, (e) => e.type === "run.decision" && isRun(e, run.id) && isVerdict(e));
    const ci = (verdict?.payload as { ci?: string } | undefined)?.ci;
    if (!ci || !folded(events, run.id) || (await this.ports.commits(card)) !== 0) return false;
    this.halt(run, card.id, `the check ${ci} is red, yet the worker found nothing to fix in the code — likely the CI infrastructure; re-run the check once fixed, the board merges the lot's PR when it turns green`, { infra: true });
    return true;
  }

  private halt(run: Run, cardId: string, reason: string, silent: { leadSilent?: true; paneId?: string; infra?: true } = {}): void {
    this.db.recordRunEvent(cardId, "run.halted", { runId: run.id, reason, ...silent });
  }
}

/** What the lead is told of a card. `category` is what makes the check an explore card's (ADR 0017). Pure. */
export function briefOf(card: Card, worktree: string, base: string): CardBrief {
  return { title: card.title, spec: card.spec, acceptance: card.acceptance, category: card.category, worktree, base };
}

// ── wiring ────────────────────────────────────────────────────────────────────

/** The live lead's pane, so the notification hook can silence it as it does the copilot's. */
let leadPane: () => string | null = () => null;
export const isLeadPane = (paneId: string): boolean => paneId === leadPane();

/**
 * The coordinator over the real routes — the one `engine.onUpdate` hook index.ts registers. Primary
 * session only, like every board hook.
 */
export function runHook(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  snapshot: () => EngineSnapshot,
  adapters: Record<string, AgentAdapter>,
): (snap: EngineSnapshot) => void {
  // ponytail: the lead runs cfg.boardCopilotKind, not `run.leadAgent` — one lead pane for every run.
  const lead = new Lead(herdr, cfg, join(cfg.stateDir, "lead"), snapshot, adapters);
  leadPane = () => lead.paneId;
  const prView = (card: Card): Card => lotPrCard(card.runId ? db.getRun(card.runId) : null, card);
  const coordinator = new RunCoordinator(db, {
    lead,
    start: async (cardId) => await startCard(db, herdr, cfg, cardId, { adapters }),
    prompt: (paneId, text) => promptAndConfirm(herdr, paneId, text),
    prepareLot: async (run, card) => {
      const r = await prepareLot(db, run, card);
      return r.ok ? { ok: true } : { ok: false, error: { kind: r.kind, message: r.error } };
    },
    fold: async (run, card) => {
      // The card forks from the lot, whatever it was filed against.
      if (card.baseRef !== run.lotBranch) db.patchCard(card.id, { baseRef: run.lotBranch }, "folded into the lot");
      const r = await foldIntoLot(card.repoPath!, run.lotBranch!, card.branch!);
      return r.ok ? { ok: true } : { ok: false, error: { kind: r.kind, message: r.error } };
    },
    openPr: (card, gate) => prForCard(db, prView(card), { autoMerge: true, gate }),
    direct: (repoPath) => db.repoIntegration(repoPath) === "direct",
    mergeDirect: async (card) => {
      const held = await exclusive(integrating, card.id, () => mergeCard(db, db.getCard(card.id) ?? card, undefined, { direct: true }));
      if (held.busy) return { ok: false, error: { kind: "busy", message: "a gesture holds the card" } };
      return held.value.ok ? { ok: true } : held.value;
    },
    land: async (card, gate) => {
      const view = prView(card);
      return (await exclusive(integrating, card.id, () => mergeWhenReady(db, card.id, view.repoPath!, view.branch!, gate))).busy ? "busy" : undefined;
    },
    refreshPr: async (card) => notePrOutcome(db, card.id, await prStatusFor(prView(card), Date.now, true)),
    resolveConflict: (card, withLot) => {
      // ADR 0041. With the lot's branch: merge it in, locally. The lot's PR against origin's base: the card
      // merges that base in and folds again — the lot picks it up from there.
      const run = card.runId ? db.getRun(card.runId) : null;
      if (card.repoPath && db.repoIntegration(card.repoPath) === "direct") return resolveConflict(db, herdr, card, "merge");
      if (run?.integration !== "lot" || !run.lotBranch) return resolveConflict(db, herdr, card, "pr");
      return withLot ? resolveConflict(db, herdr, { ...card, baseRef: run.lotBranch }, "merge") : resolveConflict(db, herdr, { ...card, baseRef: run.lotBase }, "pr");
    },
    fileAsDone: (card) => fileAsDone(db, herdr, card),
    brief: async (card) => {
      const worktree = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
      if (!worktree) return null;
      const base = await resolveBase(worktree, await baseOf(card));
      return briefOf(card, worktree, base);
    },
    stat: (cardId) => cardDiffSummary(db, cardId),
    report: async (worktree) => {
      const text = await Bun.file(join(worktree, BILAN_REL_PATH)).text().catch(() => "");
      return text.trim().slice(0, 8000) || null;
    },
    gateCommand: (card) => (card.repoPath ? db.repoGate(card.repoPath) : null),
    runGate: (command, worktree) => {
      const argv = parseGate(command);
      return argv ? runGate(argv, worktree) : Promise.resolve({ kind: "error", message: "empty gate command" });
    },
    freeSlots: () => ((db.maxAgents() ?? cfg.boardMaxAgents) || Infinity) - runningCards(db),
    reviewing: () => cfg.boardCopilot && !copilotDown(db.latestEventTypes(REVIEW_OUTCOMES, COPILOT_DOWN_AFTER)),
    commits: async (card) => {
      if (!card.repoPath || !card.branch) return null;
      return (await integrationOf(card.repoPath, card.branch, await baseOf(card)))?.ahead ?? null;
    },
    lastReply: async (paneId) => (await herdr.readPane(paneId, "recent", 40)).text.slice(-1500),
    sendBack: async (card, failure, index) => {
      const session = db.openSessionFor(card.id);
      if (!session) throw new Error("no open session to send back");
      await sendBackToWorker(db, herdr, cfg, card, session, index, failure, adapters);
    },
    advance: async (card, role, report) => {
      const session = db.openSessionFor(card.id);
      if (!session) throw new Error("no open session to advance");
      await advancePipeline(db, herdr, cfg, card, session, role, report, adapters);
    },
  });
  return (snap) => {
    lead.observe(snap);
    coordinator.update(snap);
  };
}
