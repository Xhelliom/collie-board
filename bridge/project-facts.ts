// What the journal knows about each card of a project — the "facts" a step in the project view shows
// (gate, the lead's verdict and reason, the review, the PR, how many times it was sent back…).
// Derived on every read from the cards' own journals, stored nowhere: it cannot drift from the board.

import { MILESTONE_TYPES as MILESTONES, type BoardEvent, type Card, type Decision } from "./db.ts";

export interface CardFacts {
  cardId: string;
  /** The newest gate result on this card (ADR 0020). */
  gate: { ok: boolean; command: string; ts: number } | null;
  /** The lead's newest verdict on it, with its reason (ADR 0017). */
  lead: { decision: "finished" | "prompt"; reason: string; ts: number } | null;
  /** The lead's read of the copilot's review. */
  triage: { accept: boolean; verdict: string | null; reason: string } | null;
  /** The copilot's newest review verdict: complete | partial | drift. */
  review: string | null;
  pr: { url: string | null; state: "open" | "merged" | "closed"; autoMerge?: "armed" | "refused" } | null;
  /** How many times the lead (gate included) sent the worker back. */
  sentBack: number;
  /** How many times the operator spoke to the worker. */
  operatorSaid: number;
  startedAt: number | null;
  endedAt: number | null;
  /** The template the card was started with, and the model actually passed to the agent (none: not passed). */
  template: { name: string; key: string | null; model: string | null } | null;
  /** The journal's milestone events, slimmed to what the client needs to derive the timeline's dots (web/src/lib/card-milestones.ts). */
  milestoneEvents: BoardEvent[];
}

/** The event types a card's milestones are derived from, and the payload keys each needs. */
const MILESTONE_TYPES = new Set([...MILESTONES, "card.status"]);
const MILESTONE_KEYS = ["ok", "command", "decision", "verdict", "to"];
const slim = (e: BoardEvent): BoardEvent => {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  return { ...e, payload: Object.fromEntries(MILESTONE_KEYS.filter((k) => k in p).map((k) => [k, p[k]])) };
};

const str = (p: unknown, k: string): string | null => {
  const v = (p as Record<string, unknown> | null)?.[k];
  return typeof v === "string" ? v : null;
};

/** Fold one card's journal, any order, into its facts. Pure. */
export function foldFacts(cardId: string, events: readonly BoardEvent[]): CardFacts {
  const f: CardFacts = {
    cardId,
    gate: null,
    lead: null,
    triage: null,
    review: null,
    pr: null,
    sentBack: 0,
    operatorSaid: 0,
    startedAt: null,
    endedAt: null,
    template: null,
    milestoneEvents: [],
  };
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (MILESTONE_TYPES.has(e.type)) f.milestoneEvents.push(slim(e));
    switch (e.type) {
      case "run.gate":
        f.gate = { ok: (e.payload as { ok?: boolean }).ok === true, command: str(e.payload, "command") ?? "", ts: e.ts };
        break;
      case "run.decision": {
        const d = str(e.payload, "decision");
        if (d === "finished" || d === "prompt") {
          f.lead = { decision: d, reason: str(e.payload, "reason") ?? "", ts: e.ts };
          if (d === "prompt") f.sentBack++;
        }
        break;
      }
      case "run.triaged":
        f.triage = {
          accept: (e.payload as { accept?: boolean }).accept === true,
          verdict: str(e.payload, "verdict"),
          reason: str(e.payload, "reason") ?? "",
        };
        break;
      case "review.created":
        f.review = str(e.payload, "verdict");
        break;
      case "card.pr_opened":
        f.pr = { url: str(e.payload, "url"), state: "open" };
        break;
      case "card.pr_updated": // a PR the agent opened itself: the board's first word on it
        if (f.pr?.state !== "open") f.pr = { url: str(e.payload, "url"), state: "open" };
        break;
      case "card.pr_merged":
      case "card.pr_closed":
        if (f.pr) f.pr.state = e.type === "card.pr_merged" ? "merged" : "closed";
        if (f.pr && e.type === "card.pr_merged") delete f.pr.autoMerge; // « refusé » is moot once merged
        break;
      case "card.automerge_armed":
      case "card.automerge_refused":
        if (f.pr) f.pr.autoMerge = e.type === "card.automerge_armed" ? "armed" : "refused";
        break;
      case "card.template":
        f.template = { name: str(e.payload, "name") ?? "", key: str(e.payload, "key"), model: str(e.payload, "model") };
        break;
      case "card.operator_said":
        f.operatorSaid++;
        break;
      case "session.opened":
        f.startedAt ??= e.ts;
        f.endedAt = null;
        break;
      case "session.closed":
        f.endedAt = e.ts;
        break;
    }
  }
  return f;
}

// ── route ──────────────────────────────────────────────────────────────────────

import type { BoardContext } from "./board-routes.ts";
import { memoOn } from "./http-cache.ts";
import { lotView } from "./lot.ts";
import { awaitingOn } from "./roadmap.ts";

/** How much of a card's journal is read: its newest entries are the story; a card is rarely older. */
const JOURNAL_LIMIT = 300;

/** The capped journal plus the uncapped milestone events: a card older than the cap keeps its start and its send-backs. */
const withMilestones = (journal: BoardEvent[], milestones: BoardEvent[]): BoardEvent[] => {
  const seen = new Set(journal.map((e) => e.id));
  return [...journal, ...milestones.filter((e) => !seen.has(e.id))];
};

/** `GET /api/project/facts[?repo=]` — the facts of every live card (of one repo with `repo`). Read-only. */
export function handleFactsRoute(pathname: string, req: Request, ctx: BoardContext): Response | null {
  if (pathname !== "/api/project/facts") return null;
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("read");
  if (denied) return denied;
  // No repo: every live card — the board's tiles read their dots from here (one request per poll).
  const repo = new URL(req.url).searchParams.get("repo");
  // Read from the db alone, so its revision is the whole key: an unchanged poll rebuilds nothing.
  return ctx.json(memoOn(ctx.db, `facts:${repo}`, [ctx.db.revision()], () => buildFacts(ctx, repo)));
}

function buildFacts(ctx: BoardContext, repo: string | null): { facts: unknown[] } {
  // The launched lot that still drives a card, once per lot: the board's tiles say "the lead has it"
  // from here, without loading the lots themselves (audit perf #2).
  const lots = new Map<string, ReturnType<typeof lotView> | null>();
  const lotOf = (runId: string) => {
    if (!lots.has(runId)) {
      const run = ctx.db.getRun(runId);
      const view = run && run.launchedAt !== null ? lotView(ctx.db, run) : null;
      lots.set(runId, view && !view.finished ? view : null);
    }
    return lots.get(runId)!;
  };
  // The roadmap of each repo once, for the cards the orchestrator waits on the operator about.
  const decisions = new Map<string, Decision[] | undefined>();
  const awaiting = (c: Card) => {
    if (!c.repoPath) return null;
    if (!decisions.has(c.repoPath)) decisions.set(c.repoPath, ctx.db.getRoadmap(c.repoPath)?.decisions);
    return awaitingOn(decisions.get(c.repoPath), c.id);
  };
  const facts = ctx.db
    .listCards()
    .filter((c) => !repo || c.repoPath === repo)
    .map((c) => {
      const f = foldFacts(c.id, withMilestones(ctx.db.listEvents(c.id, JOURNAL_LIMIT), ctx.db.listMilestoneEvents(c.id)));
      const lot = c.runId ? lotOf(c.runId) : null;
      const wait = awaiting(c);
      return { ...f, ...(lot ? { lot } : {}), ...(wait ? { awaiting: wait } : {}) };
    });
  return { facts };
}
