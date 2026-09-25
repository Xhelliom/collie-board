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
import { promptAndConfirm, runningCards, startCard } from "./cards.ts";
import type { Config } from "./config.ts";
import { isAutoHandoffPending, type BoardDb, type BoardEvent, type Card, type CardSession, type Run } from "./db.ts";
import { cardDiffSummary, resolveBase, worktreePathFor } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { prForCard, resolveConflict } from "./integrate.ts";
import { Lead, type CardBrief, type CheckDecision, type ConflictDecision, type TriageDecision } from "./lead.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { fileAsDone } from "./wrapup.ts";

/** How many times the lead may send a worker back before the card goes to the operator. */
export const MAX_ROUNDS = 5;

type Outcome = { ok: true } | { ok: false; error: { kind: string; message: string } };

/** Everything the coordinator acts through — the real routes in index.ts, fakes in the tests. */
export interface RunPorts {
  lead: {
    check(input: CardBrief & { statSummary: string }): Promise<CheckDecision>;
    triage(input: CardBrief & { verdict: string | null; notes: string | null; followUps: { title: string; spec?: string | null }[] }): Promise<TriageDecision>;
    recheckConflict(input: CardBrief & { conflicts: string[] }): Promise<ConflictDecision>;
  };
  /** `startCard`: worktree, `launchAgent`, first prompt. Its own gates still apply. */
  start(cardId: string): Promise<Outcome>;
  /** `promptAndConfirm` to the worker's pane. */
  prompt(paneId: string, text: string): Promise<void>;
  /** `prForCard` with auto-merge armed. */
  openPr(card: Card): Promise<Outcome>;
  /** `resolveConflict` against origin's base, to the card's own agent. */
  resolveConflict(card: Card): Promise<Outcome>;
  /** `fileAsDone`: close the session, file the card, ask for the wrapup. */
  fileAsDone(card: Card): void;
  /** What the lead reads: the worker's checkout and its base. Null when there is no checkout. */
  brief(card: Card): Promise<CardBrief | null>;
  stat(cardId: string): Promise<string>;
  /** How many more agents may start now (`db.maxAgents() ?? cfg.boardMaxAgents` minus running). */
  freeSlots(): number;
  /** Whether the copilot reviews — off, there is no review to triage and the lead goes straight to the PR. */
  reviewing(): boolean;
}

/** What a member needs next, read from the card, its journal and its pane. Null: nothing, for now. */
export type Step =
  | { kind: "start" }
  | { kind: "check" }
  | { kind: "recheck"; conflicts: string[] }
  | { kind: "triage"; sessionId: string }
  | { kind: "pr" }
  | { kind: "file" }
  | { kind: "halt"; reason: string }
  | null;

const STARTABLE = new Set<string>(["backlog", "ready"]);
const FILED = new Set<string>(["done", "archived"]);

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
    reviewing: boolean;
    /** The copilot's review of the open session: there, failed, or still to come. */
    review: "done" | "failed" | "pending";
  },
): Step {
  const halted = newest(events, (e) => e.type === "run.halted" && isRun(e, run.id));
  const landed = newest(events, (e) => e.type === "card.status" && (e.payload as { to?: string }).to === "review");

  if (STARTABLE.has(card.status)) {
    // A halt on a card never started (its start failed) holds until the operator moves it.
    if (halted) return null;
    return ctx.depsDone ? { kind: "start" } : null;
  }
  // Only a worker that has landed and sits quietly. `blocked` is a question — never ours to answer.
  if (card.status !== "review" || (ctx.pane !== "idle" && ctx.pane !== "done")) return null;
  // Busy with the board's own handoff or wrapup ask.
  if (!ctx.session || ctx.session.handoffRequestedAt !== null || isAutoHandoffPending(ctx.session)) return null;
  // Halted since this landing: the operator's until the worker lands again.
  if (after(halted, landed)) return null;

  const decision = newest(events, (e) => e.type === "run.decision" && isRun(e, run.id) && isVerdict(e));
  const resolve = newest(events, (e) => e.type === "card.resolve_requested");

  if (!after(decision, landed)) {
    // A landing nobody has judged yet. Rounds count since the last halt: the operator acting on one
    // starts the count again.
    const rounds = events.filter(
      (e) => e.type === "run.decision" && isRun(e, run.id) && after(e, halted) && (e.payload as { decision: string }).decision === "prompt",
    ).length;
    if (rounds >= MAX_ROUNDS) return { kind: "halt", reason: `${rounds} rounds without the lead finding it finished` };
    if (after(resolve, decision)) {
      const clash = newest(events, (e) => e.type === "card.pr_failed" && (e.payload as { stage?: string }).stage === "conflict");
      return { kind: "recheck", conflicts: ((clash?.payload as { files?: string[] } | null)?.files) ?? [] };
    }
    return { kind: "check" };
  }
  // The worker was sent back and has not picked it up yet.
  if ((decision!.payload as { decision: string }).decision !== "finished") return null;
  // The conflict went to the worker; its next landing is a recheck, not this.
  if (after(resolve, decision)) return null;

  if (ctx.reviewing && !events.some((e) => e.type === "run.triaged" && isRun(e, run.id))) {
    if (ctx.review === "pending") return null;
    if (ctx.review === "done") return { kind: "triage", sessionId: ctx.session.id };
  }
  const pr = newest(events, (e) => e.type === "card.pr_opened" || e.type === "card.pr_updated");
  // INTEGRATE FIRST, FILE SECOND — as the route does: filing ends the session that could settle a conflict.
  return after(pr, decision) ? { kind: "file" } : { kind: "pr" };
}

/** A check or re-check answer — the ones that move the card, not a triaged follow-up's. */
const isVerdict = (e: BoardEvent) => {
  const d = (e.payload as { decision?: string }).decision;
  return d === "finished" || d === "prompt";
};

/** A run's readable state (ADR 0017, *How a run ends*). Pure over the members and their journals. */
export function runState(run: Run, members: { card: Card; events: BoardEvent[] }[]): "finished" | "halted" | "running" {
  if (members.every((m) => FILED.has(m.card.status))) return "finished";
  const stuck = members.some(({ card, events }) => {
    if (FILED.has(card.status)) return false;
    const halted = newest(events, (e) => e.type === "run.halted" && isRun(e, run.id));
    const moved = newest(events, (e) => e.type === "card.status");
    // A halt holds until the card moves after it — the operator acting on it.
    return halted !== null && !after(moved, halted);
  });
  return stuck ? "halted" : "running";
}

export class RunCoordinator {
  /** Cards with an action in flight, so a 1.5 s tick doesn't ask twice. Memory a restart may lose. */
  private readonly busy = new Set<string>();
  /** Starts in flight: they hold a slot before their session exists. */
  private starting = 0;

  constructor(
    private readonly db: BoardDb,
    private readonly ports: RunPorts,
  ) {}

  /** Called on every snapshot. Never throws. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const panes = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p.status as string]));

    for (const run of this.db.listOpenRuns()) {
      const members = this.db.runMembers(run.id).map((card) => ({ card, events: this.db.listEvents(card.id, 200) }));
      if (members.length === 0) continue;
      if (runState(run, members) === "finished") {
        this.db.recordRunEvent(null, "run.finished", { runId: run.id });
        continue;
      }
      let slots = this.ports.freeSlots() - this.starting;
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
          reviewing: this.ports.reviewing(),
          review: reviews.length ? "done" : failed ? "failed" : "pending",
        });
        if (!step) continue;
        const start = step.kind === "start";
        if (start) {
          if (slots <= 0) continue;
          slots--;
          this.starting++;
        }
        this.busy.add(card.id);
        void this.act(run, card, session, step)
          .catch((err) => this.halt(run, card.id, (err as Error).message))
          .finally(() => {
            this.busy.delete(card.id);
            if (start) this.starting--;
          });
      }
    }
  }

  private async act(run: Run, card: Card, session: CardSession | null, step: NonNullable<Step>): Promise<void> {
    const runId = run.id;
    switch (step.kind) {
      case "halt":
        return this.halt(run, card.id, step.reason);
      case "start": {
        const r = await this.ports.start(card.id);
        // `busy` / `blocked-by` are the gates racing a tick; anything else would fail again every tick.
        if (!r.ok && r.error.kind !== "busy" && r.error.kind !== "blocked-by") this.halt(run, card.id, `start failed: ${r.error.message}`);
        return;
      }
      case "check":
      case "recheck": {
        const brief = await this.ports.brief(card);
        if (!brief) return this.halt(run, card.id, "the worker's checkout is gone");
        const d =
          step.kind === "check"
            ? await this.ports.lead.check({ ...brief, statSummary: await this.ports.stat(card.id) })
            : await this.ports.lead.recheckConflict({ ...brief, conflicts: step.conflicts });
        if (d.decision === "halt") return this.halt(run, card.id, d.reason);
        if (d.decision === "prompt") {
          await this.ports.prompt(session!.paneId!, d.prompt);
          this.db.recordRunEvent(card.id, "run.decision", { runId, decision: "prompt", prompt: d.prompt, reason: d.reason });
          return;
        }
        this.db.recordRunEvent(card.id, "run.decision", { runId, decision: "finished", reason: d.reason });
        return;
      }
      case "triage":
        return this.triage(run, card, step.sessionId);
      case "pr": {
        const r = await this.ports.openPr(card);
        if (r.ok) return this.ports.fileAsDone(this.db.getCard(card.id)!);
        if (r.error.kind !== "conflict") return this.halt(run, card.id, `PR: ${r.error.message}`);
        const settled = await this.ports.resolveConflict(card);
        if (!settled.ok) this.halt(run, card.id, `conflict not handed over: ${settled.error.message}`);
        return;
      }
      case "file":
        return this.ports.fileAsDone(card);
    }
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

  private halt(run: Run, cardId: string, reason: string): void {
    this.db.recordRunEvent(cardId, "run.halted", { runId: run.id, reason });
  }
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
  const coordinator = new RunCoordinator(db, {
    lead,
    start: async (cardId) => await startCard(db, herdr, cfg, cardId),
    prompt: (paneId, text) => promptAndConfirm(herdr, paneId, text),
    openPr: (card) => prForCard(db, card, { autoMerge: true }),
    resolveConflict: (card) => resolveConflict(db, herdr, card, "pr"),
    fileAsDone: (card) => fileAsDone(db, herdr, card),
    brief: async (card) => {
      const worktree = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
      if (!worktree) return null;
      const base = await resolveBase(worktree, card.baseRef);
      return { title: card.title, spec: card.spec, acceptance: card.acceptance, worktree, base };
    },
    stat: (cardId) => cardDiffSummary(db, cardId),
    freeSlots: () => (db.maxAgents() ?? cfg.boardMaxAgents) - runningCards(db),
    reviewing: () => cfg.boardCopilot,
  });
  return (snap) => {
    lead.observe(snap);
    coordinator.update(snap);
  };
}
