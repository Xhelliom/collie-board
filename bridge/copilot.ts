// The copilot — the board's own agent, driven exactly like a worker.
//
// No API key, no SDK, no second integration to keep alive. The "brain" is one long-lived agent
// session in a dedicated herdr workspace, prompted through the same `agent.prompt` the cards use.
// One code path for the cerebrum and the limbs, and a session you can OPEN IN THE TUI when a
// reformulation comes out wrong — which is worth more than any amount of structured-output plumbing.
//
// THE OUTPUT CONTRACT: A FILE, NEVER THE TERMINAL. Every prompt ends with "write the result as JSON
// to .board/out/<id>.json and print nothing else". Scraping JSON out of a rendered TUI is a losing
// game — wrapped lines, spinners, ANSI, a helpful preamble — and the file is both exact and
// understood by every agent without a single agent-specific line of code. The FILE APPEARING is also
// the completion signal, which is stronger than any status: `agent.prompt` doesn't reliably submit
// (see cards.ts) and `idle` only means the agent stopped talking.
//
// COST. This spends the same subscription the workers do, so it is OFF by default
// (`COLLIE_BOARD_COPILOT=on`) and serialised to exactly one request at a time — one pane is one
// queue, which is free rate limiting.

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { adapterFor, type AgentAdapter } from "./adapters.ts";
import type { Config } from "./config.ts";
import type { BoardDb } from "./db.ts";
import { agentNameFor, launchAgent, promptAndConfirm } from "./cards.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** Label of the workspace the copilot lives in. Found by label so a restart re-uses it. */
export const COPILOT_WORKSPACE_LABEL = "board";

/** Where the copilot writes its answers, relative to its own working directory. */
const OUT_DIR = ".board/out";

/** How long one request may take before we give up and free the queue. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** How often we look for the answer file. */
const POLL_MS = 2000;

/**
 * Requests before the session is reset.
 *
 * The copilot fills its own context like anything else, and every prompt here is self-contained by
 * construction — nothing is carried between requests — so clearing costs nothing and keeps each
 * answer cheap.
 */
const RESET_EVERY = 8;

/**
 * Parse the copilot's answer file.
 *
 * Tolerant on purpose. The instruction says "JSON and nothing else", and agents mostly comply — but
 * a fenced ```json block is the single most common deviation, and refusing it would throw away a
 * perfectly good answer over three backticks. Anything else is a hard failure: a half-understood
 * answer is worse than none. Pure + exported.
 */
export function parseJsonish(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  const body = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** What a reformulation is expected to produce. Absent/typo'd fields simply don't get applied. */
export interface Reformulation {
  title?: string;
  spec?: string;
  acceptance?: string[];
  branchName?: string;
  splitSuggestion?: string[];
}

/** What a post-`done` review is expected to produce. */
export interface ReviewResult {
  verdict?: string;
  notes?: string;
  todos?: string[];
}

/**
 * Sanitise a copilot-suggested branch name. It is model output landing in `git worktree add` and in
 * a directory name, so it gets the same allowlist treatment as a slugified title. Pure + exported.
 */
export function slugBranch(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "card";
}

/** Narrow an unknown parsed object to the string/array fields we actually use. */
function str(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function strList(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return list.length ? list : undefined;
}

/** Coerce a parsed answer into a {@link Reformulation}, dropping anything malformed. Pure. */
export function toReformulation(parsed: unknown): Reformulation | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const out: Reformulation = {};
  const title = str(o, "title");
  const spec = str(o, "spec");
  const branch = str(o, "branch_name") ?? str(o, "branchName");
  if (title) out.title = title;
  if (spec) out.spec = spec;
  if (branch) out.branchName = branch;
  const acceptance = strList(o, "acceptance");
  if (acceptance) out.acceptance = acceptance;
  const split = strList(o, "split_suggestion") ?? strList(o, "splitSuggestion");
  if (split) out.splitSuggestion = split;
  return Object.keys(out).length ? out : null;
}

/** Coerce a parsed answer into a {@link ReviewResult}. Pure. */
export function toReviewResult(parsed: unknown): ReviewResult | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const out: ReviewResult = {};
  const verdict = str(o, "verdict");
  const notes = str(o, "notes");
  if (verdict) out.verdict = verdict;
  if (notes) out.notes = notes;
  const todos = strList(o, "todos");
  if (todos) out.todos = todos;
  return Object.keys(out).length ? out : null;
}

/**
 * The prompt that turns a brain dump into a card. Explicitly tells the agent NOT to do the work —
 * a coding agent handed a task description will start editing files unless told otherwise, and this
 * one has no repo to edit. Pure + exported so the wording is reviewable.
 */
export function reformulatePrompt(rawInput: string, outPath: string): string {
  return [
    "You are triaging a task for a kanban board. Do NOT do the work, do not write any code, do not",
    "read any repository. Turn the note below into one well-formed card.",
    "",
    "The note (dictated, so expect stream-of-consciousness):",
    "---",
    rawInput.trim(),
    "---",
    "",
    `Write ONLY this JSON to ${outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "title": "one short imperative line",',
    '  "spec": "markdown: what to do and any constraint stated in the note. Do not invent requirements.",',
    '  "acceptance": ["checkable statement", "..."],',
    '  "branch_name": "kebab-case, no prefix",',
    '  "split_suggestion": ["only if the note is clearly several tasks; otherwise an empty list"]',
    "}",
  ].join("\n");
}

/**
 * The post-`done` review prompt. Takes `git diff --stat` and the handoff note, NEVER the full diff:
 * the stat is enough to judge drift from the acceptance criteria, and the full diff would burn the
 * quota this feature is supposed to be careful with. Pure + exported.
 */
export function reviewPrompt(input: {
  title: string;
  spec: string | null;
  acceptance: string[];
  statSummary: string;
  handoffMd: string | null;
  outPath: string;
}): string {
  const parts = [
    "You are reviewing finished work on a kanban card. Do NOT edit anything and do not read the",
    "repository — judge only from what is below.",
    "",
    `Card: ${input.title}`,
  ];
  if (input.spec) parts.push("", "Spec:", input.spec);
  if (input.acceptance.length) {
    parts.push("", "Acceptance criteria:", ...input.acceptance.map((a) => `- ${a}`));
  }
  parts.push("", "What changed (git diff --stat):", input.statSummary);
  if (input.handoffMd) parts.push("", "The agent's own handoff note:", input.handoffMd);
  parts.push(
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "verdict": "complete | partial | drift",',
    '  "notes": "one short paragraph: what looks done, what looks missing or off-spec",',
    '  "todos": ["each follow-up as its own card title; empty list if there are none"]',
    "}",
  );
  return parts.join("\n");
}

/**
 * A single long-lived agent, serialised. `ask()` resolves with the parsed JSON the agent wrote, or
 * null — every caller treats null as "no copilot answer this time" and carries on, because the whole
 * feature is optional by design.
 */
export class Copilot {
  /** The pane the copilot lives in, once it has one. */
  private paneId: string | null = null;
  /** Set by ensurePane, consumed by the next prompt — see promptAndConfirm's `firstAfterLaunch`. */
  private justLaunched = false;
  /** Serialises requests: one pane is one queue, which is free rate limiting. */
  private queue: Promise<unknown> = Promise.resolve();
  private requestsSinceReset = 0;

  constructor(
    private readonly herdr: HerdrClient,
    private readonly cfg: Config,
    /** The copilot's own working directory — it needs one, and it must not be a real repo. */
    private readonly workDir: string,
    /** The live herd, for adopting a copilot pane that already exists (see ensurePane). */
    private readonly snapshot: () => EngineSnapshot,
    /** Per-agent divergence (the reset command). See adapters.ts. */
    private readonly adapters: Record<string, AgentAdapter> = {},
    /** Deadline + poll cadence for one request. Injectable so the tests don't wait five minutes. */
    private readonly timing: { timeoutMs?: number; pollMs?: number } = {},
  ) {}

  /** The agent kind the copilot runs, and its adapter. */
  private get adapter(): AgentAdapter {
    return adapterFor(this.adapters, this.cfg.boardCopilotKind || this.cfg.boardAgentKind);
  }

  get enabled(): boolean {
    return this.cfg.boardCopilot;
  }

  /** Where the answers land on disk. */
  private outPathFor(id: string): { abs: string; rel: string } {
    return { abs: join(this.workDir, OUT_DIR, `${id}.json`), rel: `${OUT_DIR}/${id}.json` };
  }

  /**
   * Ask one question. Serialised behind every earlier request, so a burst of cards being reviewed
   * costs one agent turn at a time rather than N in parallel against a shared quota.
   */
  ask(buildPrompt: (outPath: string) => string): Promise<unknown | null> {
    if (!this.enabled) return Promise.resolve(null);
    const run = this.queue.then(() => this.run(buildPrompt)).catch(() => null);
    // The queue must never adopt a rejection, or one failure would poison every later request.
    this.queue = run.catch(() => null);
    return run;
  }

  private async run(buildPrompt: (outPath: string) => string): Promise<unknown | null> {
    const id = crypto.randomUUID().slice(0, 8);
    const { abs, rel } = this.outPathFor(id);
    try {
      await this.ensurePane();
      if (!this.paneId) return null;
      await mkdir(join(this.workDir, OUT_DIR), { recursive: true, mode: 0o700 });
      // Stale file from a previous run with the same id would be read as this answer.
      await rm(abs, { force: true });

      if (this.requestsSinceReset >= RESET_EVERY) await this.reset();
      this.requestsSinceReset++;

      // Same delivery problems as everywhere else (see promptAndConfirm): an unsubmitted prompt, or
      // one eaten whole by the first-run trust dialog, would burn this request's five-minute
      // deadline waiting for a file nobody was ever going to write.
      const first = this.justLaunched;
      this.justLaunched = false;
      await promptAndConfirm(this.herdr, this.paneId, buildPrompt(rel), undefined, {
        firstAfterLaunch: first,
      });
      const answer = await this.awaitFile(abs);
      if (answer === null) {
        console.warn(`[copilot] no answer at ${rel} within the deadline — see pane ${this.paneId}`);
      }
      return answer;
    } catch (err) {
      // Never rethrow — the copilot is optional by design — but never go quiet either. A silent
      // catch here is exactly what made a swallowed first prompt take an hour to find.
      console.warn(`[copilot] request failed: ${(err as Error).message}`);
      // The pane may be the problem; drop it so the next request rebuilds one.
      this.paneId = null;
      return null;
    } finally {
      await rm(abs, { force: true }).catch(() => {});
    }
  }

  /** Poll for the answer file. Its APPEARANCE is the completion signal — see the header. */
  private async awaitFile(abs: string): Promise<unknown | null> {
    const poll = this.timing.pollMs ?? POLL_MS;
    const deadline = Date.now() + (this.timing.timeoutMs ?? REQUEST_TIMEOUT_MS);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, poll));
      const file = Bun.file(abs);
      if (!(await file.exists())) continue;
      // A file that exists but doesn't parse yet is very likely a half-written write; one retry
      // costs a poll interval, and the deadline still bounds us.
      const parsed = parseJsonish(await file.text());
      if (parsed !== null) return parsed;
    }
    return null;
  }

  /**
   * Find or create the copilot's workspace + agent. Idempotent, and it has to be: a bridge restart
   * loses `paneId` while the pane keeps living in the herd.
   *
   * ADOPTION FIRST, and not as an optimisation. Herdr agent names are globally unique, so blindly
   * creating a second copilot fails with `agent_name_taken` — and it leaves an orphan `board`
   * workspace behind on every restart before it does. Found live: the copilot was dead for exactly
   * that reason, silently, until this class started logging.
   */
  private async ensurePane(): Promise<void> {
    if (this.paneId) return;
    await mkdir(this.workDir, { recursive: true, mode: 0o700 });

    const snap = this.snapshot();
    const mine = (paneId: string) => snap.agents.some((a) => a.paneId === paneId);
    const here = [...snap.agents, ...snap.shellPanes].filter((p) => p.cwd === this.workDir);

    // An agent already running in our directory IS the copilot — reuse it as-is.
    const running = here.find((p) => mine(p.paneId));
    if (running) {
      this.paneId = running.paneId;
      console.log(`[copilot] adopted the existing agent in ${running.paneId}`);
      return;
    }

    // A bare shell left over from a previous life: relaunch into it rather than stacking another
    // workspace next to it.
    const shell = here[0];
    const paneId =
      shell?.paneId ??
      (
        await this.herdr.createWorkspace({
          cwd: this.workDir,
          label: COPILOT_WORKSPACE_LABEL,
        })
      ).paneId;

    const kind = this.cfg.boardCopilotKind || this.cfg.boardAgentKind;
    await launchAgent(this.herdr, paneId, kind, agentNameFor(COPILOT_WORKSPACE_LABEL));
    this.paneId = paneId;
    this.requestsSinceReset = 0;
    this.justLaunched = true;
    console.log(`[copilot] agent ready in ${paneId} (${this.workDir})`);
  }

  /**
   * Reset the session's context. The command is the agent's, from the adapter table — an agent with
   * no reset command simply doesn't get one, and the pane is left to fill up (still bounded, since
   * every prompt here is self-contained).
   */
  private async reset(): Promise<void> {
    const clear = this.cfg.boardCopilotClear || this.adapter.clear;
    if (!this.paneId || !clear) return;
    try {
      await promptAndConfirm(this.herdr, this.paneId, clear);
      this.requestsSinceReset = 0;
    } catch {
      // A failed clear only means a fuller context next request — not worth failing over.
    }
  }

  /**
   * Drop the pane if it has vanished from the herd, so the next request rebuilds it. Called from the
   * poll loop; costs nothing when the copilot is idle or disabled.
   */
  observe(snap: EngineSnapshot): void {
    if (!this.paneId || snap.bridge === "disconnected") return;
    const live = [...snap.agents, ...snap.shellPanes].some((p) => p.paneId === this.paneId);
    if (!live) this.paneId = null;
  }
}

// ── board-facing work ─────────────────────────────────────────────────────────

/**
 * Wires the copilot to the board: reformulate a dictated card, and review one when its agent
 * finishes. Both are fire-and-forget — a card is fully usable if neither ever runs, which is what
 * lets the whole feature default to off.
 */
export class CopilotCoordinator {
  /** Cards whose review is in flight, so the poll doesn't queue the same one every 1.5 s. */
  private readonly reviewing = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly copilot: Copilot,
    private readonly cfg: Config,
  ) {}

  /**
   * Turn a card's raw brain dump into a real card, in the background.
   *
   * Background is the point: creating a card must be instant on a phone, and a reformulation is an
   * agent turn. The card exists immediately with a derived title; this fills it in a minute later and
   * the board picks it up on the next poll.
   *
   * NEVER overwrites what a human typed — only fields still at their derived defaults.
   */
  async reformulate(cardId: string): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!card?.rawInput || !this.copilot.enabled) return;
    const parsed = await this.copilot.ask((out) => reformulatePrompt(card.rawInput!, out));
    const result = toReformulation(parsed);
    if (!result) {
      this.db.recordEvent(cardId, "copilot.reformulate_failed", {});
      return;
    }
    const fresh = this.db.getCard(cardId);
    if (!fresh) return;
    this.db.patchCard(cardId, {
      ...(result.title ? { title: result.title } : {}),
      // The spec starts life as a copy of the dump, so replacing it is an improvement, not a loss —
      // and rawInput keeps the original either way.
      ...(result.spec ? { spec: result.spec } : {}),
      ...(result.acceptance ? { acceptance: result.acceptance } : {}),
      // A branch the card already has is load-bearing (a worktree may exist at it) — never touch it.
      ...(result.branchName && !fresh.branch
        ? { branch: `${this.cfg.boardBranchPrefix}${slugBranch(result.branchName)}` }
        : {}),
    });
    this.db.recordEvent(cardId, "copilot.reformulated", {
      title: result.title,
      acceptance: result.acceptance?.length ?? 0,
      split: result.splitSuggestion?.length ?? 0,
    });
    // A dump that is plainly several tasks becomes several cards, in the backlog, for you to triage.
    for (const title of result.splitSuggestion ?? []) {
      this.db.createCard({
        title,
        status: "backlog",
        repoPath: fresh.repoPath,
        baseRef: fresh.baseRef,
      });
    }
  }

  /**
   * Review every card that has just landed in `review` and hasn't been reviewed for THIS session.
   * Keyed on the session, so a card handed off and finished again gets reviewed again.
   *
   * This is what closes the loop: the `todos` become cards, so the board refills itself from what
   * the agents left undone.
   */
  update(snap: EngineSnapshot, statFor: (cardId: string) => Promise<string>): void {
    this.copilot.observe(snap);
    if (!this.copilot.enabled || snap.bridge === "disconnected") return;

    for (const card of this.db.listLiveCards()) {
      if (card.status !== "review" || this.reviewing.has(card.id)) continue;
      const session = this.db.openSessionFor(card.id) ?? this.db.listSessions(card.id).at(-1);
      if (!session) continue;
      if (this.db.listReviews(card.id).some((r) => r.sessionId === session.id)) continue;

      this.reviewing.add(card.id);
      void this.review(card.id, session.id, statFor)
        .catch(() => {})
        .finally(() => this.reviewing.delete(card.id));
    }
  }

  private async review(
    cardId: string,
    sessionId: string,
    statFor: (cardId: string) => Promise<string>,
  ): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!card) return;
    const session = this.db.getSession(sessionId);
    const statSummary = await statFor(cardId);
    const parsed = await this.copilot.ask((out) =>
      reviewPrompt({
        title: card.title,
        spec: card.spec,
        acceptance: card.acceptance,
        statSummary,
        handoffMd: session?.handoffMd ?? null,
        outPath: out,
      }),
    );
    const result = toReviewResult(parsed);
    if (!result) {
      this.db.recordEvent(cardId, "copilot.review_failed", { sessionId });
      return;
    }
    this.db.createReview({
      cardId,
      sessionId,
      verdict: result.verdict ?? null,
      notes: result.notes ?? null,
      todos: result.todos ?? [],
    });
    // The loop closes here: what the agent left in plan becomes the next cards.
    for (const title of result.todos ?? []) {
      this.db.createCard({
        title,
        status: "backlog",
        repoPath: card.repoPath,
        baseRef: card.baseRef,
      });
    }
  }
}
