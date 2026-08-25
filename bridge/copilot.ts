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
import {
  CARD_CATEGORIES,
  isPendingWrapup,
  normalizeTag,
  type BoardDb,
  type Card,
  type CardCategory,
  type ReviewTodo,
} from "./db.ts";
import { agentNameFor, launchAgent, promptAndConfirm } from "./cards.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";

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
 * How many existing cards the duplicate check is shown.
 *
 * A ceiling, not a tuning knob: the whole list rides inside the reformulation prompt, and a board
 * with hundreds of cards would bury the note being triaged under its own history. Newest first, so
 * what is dropped is the oldest — the cards least likely to be re-dictated today.
 */
const DUPLICATE_CANDIDATES = 60;

/**
 * How many existing tags the copilot is shown when it has to tag a card.
 *
 * Same ceiling logic as above, and the inventory is most-recently-touched first, so what falls off
 * is the vocabulary nobody has used in months. A tag the model can't see is a tag it will re-invent.
 */
const TAG_INVENTORY = 40;

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

/**
 * One task carved out of a multi-task dump. A FULL card, not a title: the dump is the only place
 * the context ever existed, and the copilot has it open — dropping everything but the title (which
 * is what the first version of this did) throws that away and leaves you retyping it by hand.
 */
export interface SplitTask {
  title: string;
  spec?: string;
  acceptance?: string[];
  /** The one tag this card carries, as PROPOSED — snapped onto the inventory by {@link pickTag}. */
  tag?: string;
  /**
   * What kind of follow-up this is, as PROPOSED — snapped onto the vocabulary by
   * {@link pickCategory}. Only ever asked for, and only ever applied, on a review's follow-ups: a
   * split is a card you dictated, and those carry no category (see {@link Card.category}).
   */
  category?: string;
  /**
   * Index of an EARLIER task in the same list that must finish first, or absent for "independent".
   *
   * Backward-only by construction, which is what makes a dependency cycle unrepresentable rather
   * than merely unlikely — no graph validation, no visited set, nothing to get wrong at 3am.
   */
  dependsOn?: number;
}

/** What a reformulation is expected to produce. Absent/typo'd fields simply don't get applied. */
export interface Reformulation {
  title?: string;
  spec?: string;
  acceptance?: string[];
  branchName?: string;
  /** The one tag this card carries, as PROPOSED — snapped onto the inventory by {@link pickTag}. */
  tag?: string;
  /** An existing card id this one repeats, as JUDGED — validated against the board before it lands. */
  duplicateOf?: string;
  split?: SplitTask[];
}

/** What an error explanation is expected to produce. */
export interface Explanation {
  meaning?: string;
  next?: string;
  likelyBug?: boolean;
}

/** What a post-`done` review is expected to produce. */
export interface ReviewResult {
  verdict?: string;
  notes?: string;
  /** Full cards, not bare titles — see the warning on {@link SplitTask}. */
  todos?: SplitTask[];
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

/**
 * Coerce the `split` field into {@link SplitTask}s, dropping anything malformed. Pure + exported.
 *
 * Accepts BOTH the object form and a bare list of titles: the prompt asks for objects, but the
 * older shape is exactly what a model falls back to under pressure, and answering a good split with
 * "nothing" over its shape would be the worst of both. A title is the one field that must be there.
 *
 * `depends_on` is only honoured when it points BACKWARD in the list. A forward or self reference is
 * dropped to "independent" — worst case you start something a beat early, whereas honouring it
 * would build a cycle that wedges both cards behind each other permanently.
 */
export function toSplit(v: unknown): SplitTask[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SplitTask[] = [];
  // Indices in the answer are the MODEL's, and a malformed entry shifts everything after it — so
  // `depends_on` is translated through this rather than used raw. Without it, one dropped entry
  // silently re-points every dependency that follows at the wrong task.
  const kept = new Map<number, number>();
  for (const [i, entry] of v.entries()) {
    if (typeof entry === "string") {
      if (!entry.trim()) continue;
      kept.set(i, out.length);
      out.push({ title: entry.trim() });
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    const title = str(o, "title");
    if (!title) continue;
    const task: SplitTask = { title };
    const spec = str(o, "spec");
    if (spec) task.spec = spec;
    const tag = str(o, "tag");
    if (tag) task.tag = tag;
    const category = str(o, "category");
    if (category) task.category = category;
    const acceptance = strList(o, "acceptance");
    if (acceptance) task.acceptance = acceptance;
    const dep = o.depends_on ?? o.dependsOn;
    if (typeof dep === "number" && Number.isInteger(dep) && dep >= 0 && dep < i) {
      const mapped = kept.get(dep);
      // A dependency on an entry that was itself dropped becomes "independent" — there is nothing
      // left to wait for.
      if (mapped !== undefined) task.dependsOn = mapped;
    }
    kept.set(i, out.length);
    out.push(task);
  }
  return out.length ? out : undefined;
}

/** Coerce a parsed answer into a {@link Reformulation}, dropping anything malformed. Pure. */
export function toReformulation(parsed: unknown): Reformulation | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const out: Reformulation = {};
  const title = str(o, "title");
  const spec = str(o, "spec");
  const branch = str(o, "branch_name") ?? str(o, "branchName");
  const tag = str(o, "tag");
  if (title) out.title = title;
  if (spec) out.spec = spec;
  if (branch) out.branchName = branch;
  if (tag) out.tag = tag;
  const acceptance = strList(o, "acceptance");
  if (acceptance) out.acceptance = acceptance;
  // Taken as a plain string here and checked against the board by the caller: the model is being
  // asked to echo back an id it was shown, and "it looks like an id" proves nothing about that.
  const duplicate = str(o, "duplicate_of") ?? str(o, "duplicateOf");
  if (duplicate && duplicate !== "null") out.duplicateOf = duplicate;
  // `split_suggestion` is the field name this used to have, kept as an alias so a reformulation
  // that comes back in the old shape still splits instead of silently doing nothing.
  const split = toSplit(o.split) ?? toSplit(o.split_suggestion) ?? toSplit(o.splitSuggestion);
  if (split) out.split = split;
  return Object.keys(out).length ? out : null;
}

/** Coerce a parsed answer into an {@link Explanation}. Pure. */
export function toExplanation(parsed: unknown): Explanation | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const out: Explanation = {};
  const meaning = str(o, "meaning");
  const next = str(o, "next");
  if (meaning) out.meaning = meaning;
  if (next) out.next = next;
  const bug = o.likely_bug ?? o.likelyBug;
  if (typeof bug === "boolean") out.likelyBug = bug;
  // Without at least one of the two paragraphs there is nothing to show, and a card journal entry
  // saying only "likely_bug: false" would be worse than the raw error it replaced.
  return out.meaning || out.next ? out : null;
}

/**
 * Ask the copilot for a push notification's subtitle — one line naming what an agent actually just
 * did or asked, in place of the bare card title. See notify-subtitle.ts, which is the only caller and
 * owns the "is there enough to work with" decision; this just phrases the prompt. Pure + exported so
 * the wording is reviewable.
 */
export function notifySubtitlePrompt(input: {
  verb: "needs input" | "finished";
  cardTitle?: string;
  cardSpec?: string | null;
  /** `git diff --stat` against the card's base ref — `done` only; a `blocked` alert has no diff yet. */
  statSummary?: string | null;
  /** The agent's own last transcript message — often the plainest account there is of what it did or
   *  is asking, in its own words. */
  lastMessage?: string | null;
  outPath: string;
}): string {
  const parts = [
    "Someone glances at a push notification on their phone about a coding agent. Write ONE short",
    "phrase, under 60 characters, for the notification's subtitle — replacing a bare card title with",
    "what the agent actually just did or is asking. Do NOT act, run anything, or read the repository:",
    "judge only from what is below.",
    "",
    `The agent just ${input.verb}.`,
  ];
  if (input.cardTitle) parts.push(`Card: ${input.cardTitle}`);
  if (input.cardSpec) parts.push("Spec:", input.cardSpec);
  if (input.statSummary) parts.push("", "What changed (git diff --stat):", input.statSummary);
  if (input.lastMessage) parts.push("", "The agent's own last message:", "---", input.lastMessage, "---");
  parts.push(
    "",
    "Name the concrete outcome or question, not the task category — \"renamed the auth middleware\"",
    "beats \"finished refactor\", \"needs the API key for staging\" beats \"needs input\". Plain words,",
    "no markdown, no trailing period.",
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "subtitle": "under 60 characters"',
    "}",
  );
  return parts.join("\n");
}

/** Coerce a parsed answer into the notification subtitle string, or null. Pure + exported. */
export function toNotifySubtitle(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const subtitle = str(parsed as Record<string, unknown>, "subtitle");
  if (!subtitle) return null;
  // Defensive, not trusting: a model told "under 60 characters" occasionally hands back three times
  // that, and this is about to sit in a push notification's one visible line.
  return subtitle.replace(/\s+/g, " ").slice(0, 140);
}

/**
 * Snap a copilot-proposed tag onto the tags the board already uses, or keep it as a new one.
 *
 * NOT PURE, deliberately: a tag it accepts as new is PUSHED onto `inventory`, which is what makes a
 * run of cards from one answer agree with each other and not just with the board. Callers pass their
 * own array (`db.listTags()` returns a fresh one) and let it grow for the length of one answer.
 *
 * THE ENFORCEMENT OF "REUSE FIRST". The prompt asks for it, and a prompt is a request — this is what
 * makes it true. A model handed `frontend` will answer `front-end` often enough that the filter
 * strip fills with near-duplicates, and a filter you have to tap twice for one thing is worse than
 * no filter. Matching ignores everything that is not a letter or a digit, which is exactly the class
 * of variation a model invents (`front-end`, `front end`, `Frontend`); `normalizeTag` already folds
 * case and spacing at the database, but it cannot know what `frontend` looked like yesterday. The
 * EXISTING spelling wins, always — the board's vocabulary is not up for renegotiation per card.
 *
 * ponytail: exact match after folding, no stemming — `test` and `tests` stay two tags. Plural rules
 * that guess are how `bus` becomes `bu`; if near-misses pile up, dedupe them in the tag field where
 * a human can see the merge, not here where it happens silently.
 */
export function pickTag(proposed: string | undefined, inventory: string[]): string | null {
  const tag = normalizeTag(proposed);
  if (!tag) return null;
  const fold = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const key = fold(tag);
  const existing = inventory.find((t) => fold(t) === key);
  // A tag invented HERE joins the inventory, so the next card in the same answer snaps onto it. One
  // split naming `front-end` then `frontend` is the likeliest near-duplicate there is: the cards
  // come from one theme, in one breath, and neither spelling was on the board a second ago.
  if (!existing) inventory.push(tag);
  return existing ?? tag;
}

/**
 * Snap a copilot-proposed category onto the closed vocabulary. Pure + exported.
 *
 * Unlike {@link pickTag} this invents NOTHING: the vocabulary is the whole point — a sixth category
 * the model made up would be a card that no filter built on these five can see. Anything it doesn't
 * recognise, and a missing answer, land on `chore`: the bucket that already means "the rest", and
 * the safe direction — a mis-filed chore is noise, a mis-filed `test` is a card hidden by a filter
 * that was meant to hide the noise.
 */
export function pickCategory(proposed: string | undefined): CardCategory {
  const key = proposed?.trim().toLowerCase();
  return CARD_CATEGORIES.find((c) => c === key) ?? "chore";
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
  const todos = toSplit(o.todos);
  if (todos) out.todos = todos;
  return Object.keys(out).length ? out : null;
}

/**
 * The tagging rule, shown to every prompt that writes a card. Pure.
 *
 * The inventory has to be IN FRONT OF THE MODEL as it writes, not checked after: a tag invented
 * first and reconciled later is a tag the model has already justified to itself, and `pickTag` can
 * only catch the spellings that are one hyphen apart. Shown even when empty, because "there are no
 * tags yet" is itself the answer to "which one should I reuse".
 */
function tagRule(tags: string[]): string[] {
  const shown = tags.slice(0, TAG_INVENTORY);
  return [
    "",
    "TAG. Every card carries exactly one short lowercase label naming the AREA of work it belongs to",
    "(`bug`, `infra`, `ui`, `docs`, …) — never its urgency, its status, or a restatement of its title.",
    ...(shown.length
      ? [
          `Tags already used on this board: ${shown.join(", ")}.`,
          "Pick one of those, copied VERBATIM, whenever it fits the work — the board is filtered by",
          "tag, and a second spelling of a tag that exists splits that filter in two. Invent a new one",
          "ONLY when none of them describes this work; then one or two lowercase words, no punctuation.",
        ]
      : ["This board has no tags yet, so name the area in one or two lowercase words."]),
  ];
}

/**
 * The prompt that turns a brain dump into a card. Explicitly tells the agent NOT to do the work —
 * a coding agent handed a task description will start editing files unless told otherwise, and this
 * one has no repo to edit. Pure + exported so the wording is reviewable.
 */
export function reformulatePrompt(
  rawInput: string,
  outPath: string,
  /** Cards already on the board for the same repo — the duplicate check's whole input. */
  existing: { id: string; title: string; status: string }[] = [],
  /** The tag inventory — see {@link tagRule}. */
  tags: string[] = [],
): string {
  return [
    "You are triaging a task for a kanban board. Do NOT do the work, do not write any code, do not",
    "read any repository. Turn the note below into one well-formed card, or into a set of them.",
    "",
    "The note (dictated, so expect stream-of-consciousness):",
    "---",
    rawInput.trim(),
    "---",
    ...(existing.length
      ? [
          "",
          "Cards already on this board for the same repository:",
          ...existing.map((c) => `- ${c.id} [${c.status}] ${c.title}`),
          "",
          "If the note describes work ALREADY COVERED by one of them, put that card's id in",
          "`duplicate_of`. Judge by the work to be done, not by wording: two cards can share half",
          "their words and be different tasks, and the same task can be described twice with no word",
          "in common. A card that merely touches the same area is NOT a duplicate. When in doubt,",
          "leave it null — a wrong link is noise on a board someone has to read.",
          "Still fill in title/spec/acceptance normally; the link is a note, not a refusal.",
        ]
      : []),
    "",
    ...tagRule(tags),
    "",
    "First decide: is this ONE task, or several?",
    "",
    "ONE TASK — fill title/spec/acceptance/branch_name/tag and leave `split` as an empty list.",
    "",
    "SEVERAL TASKS — every task goes in `split`, and NONE stays at the top level. The top-level card",
    "becomes a container holding them; its title should name the theme they share, not any one of",
    "them. Do not repeat a task in the container's title, and do not leave a task out of `split`.",
    "Each entry is a COMPLETE card — give it the same care as a single one, with its own spec and",
    "its own acceptance criteria, drawn from what the note says about THAT task. Never emit a bare",
    "title: the note is the only place this context exists, and it is in front of you now.",
    "",
    "For each entry, `depends_on` is the index of an EARLIER entry that must be finished before this",
    "one can start — a real ordering constraint (it needs the other one's code or its conclusions),",
    "not merely a sensible order to work in. Omit it when the task can be started on its own; most",
    "can. Order the list so any such entry comes after what it depends on.",
    "",
    `Write ONLY this JSON to ${outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "title": "one short imperative line",',
    '  "spec": "markdown: what to do and any constraint stated in the note. Do not invent requirements.",',
    '  "acceptance": ["checkable statement", "..."],',
    '  "branch_name": "kebab-case, no prefix",',
    '  "tag": "an existing tag copied verbatim, or a new one when none fits",',
    '  "duplicate_of": "id of an existing card this repeats, or null",',
    '  "split": [',
    '    { "title": "…", "spec": "…", "acceptance": ["…"], "tag": "…", "depends_on": null }',
    "  ]",
    "}",
  ].join("\n");
}

/**
 * The prompt that applies ONE free-text correction to a card that already exists.
 *
 * Its input is the CARD AS IT STANDS, never the original dictation — that is the whole difference
 * with {@link reformulatePrompt}, and the reason both exist. Reformulating re-reads the dump and
 * throws the current text away, which is right when the first pass came out wrong and useless when
 * nine tenths of it is fine and one sentence is not.
 *
 * No duplicate check, no split, no tag: a correction is not a re-triage. Every one of those would
 * spend prompt space arguing against "change nothing else", which is the only rule this prompt has.
 * Pure + exported so the wording is reviewable.
 */
export function refinePrompt(input: {
  title: string;
  spec: string | null;
  acceptance: string[];
  instruction: string;
  outPath: string;
}): string {
  const parts = [
    "You are correcting ONE card on a kanban board. Do NOT do the work, do not write any code, do not",
    "read any repository. Rewrite the card below so it says what the correction asks for.",
    "",
    "The card as it stands:",
    `Title: ${input.title}`,
  ];
  if (input.spec) parts.push("", "Spec:", input.spec);
  if (input.acceptance.length) {
    parts.push("", "Acceptance criteria:", ...input.acceptance.map((a) => `- ${a}`));
  }
  parts.push(
    "",
    "The correction, from the person this card belongs to:",
    "---",
    input.instruction.trim(),
    "---",
    "",
    "Apply it and CHANGE NOTHING ELSE. Everything the correction does not touch comes back as it is,",
    "word for word — this is a correction, not a second opinion on the whole card. When the correction",
    "settles a question the card left open (\"the format is not specified\" → \"it will be JSON\"),",
    "replace that question EVERYWHERE the card asks it, acceptance criteria included.",
    "",
    "Return the WHOLE card, corrected — what you write replaces it, so a field you leave out is a",
    "field the card loses.",
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "title": "one short imperative line",',
    '  "spec": "markdown: the corrected spec",',
    '  "acceptance": ["checkable statement", "..."]',
    "}",
  );
  return parts.join("\n");
}

/**
 * Ask the copilot to translate a raw tool error into something the operator can act on.
 *
 * SCOPED TO THE MESSAGES WE DID NOT WRITE. The board's own refusals are already sentences aimed at a
 * person ("main has uncommitted changes — a merge would land on top of them"); handing those to an
 * agent would only add noise. What this is for is the text relayed verbatim from git or herdr —
 * `worktree_remove_failed: fatal: … use --force to delete it` — which is jargon from a tool the
 * operator may never use directly.
 *
 * IT MUST NOT ACT. The copilot is a Claude session like any other, so it can reach whatever skills
 * the machine has — including, since this board grew one, a skill that drives this very API. That is
 * a capability we never want it to use: every action the copilot takes today goes through bridge
 * code, which is deterministic, gated and journalled, and "the board makes a thing possible, the
 * operator decides it happens" is the rule the whole design rests on. Hence the refusal at the top
 * of the prompt, stated before the error is even shown.
 *
 * Pure + exported so the wording is reviewable.
 */
export function explainPrompt(input: {
  action: string;
  error: string;
  cardTitle: string;
  outPath: string;
}): string {
  return [
    "Someone is driving a kanban board from their phone. It runs agents in git worktrees for them,",
    "and one of its actions just failed with an error from an underlying tool. Explain it to them.",
    "",
    "DO NOT ACT. Do not run any command, do not call any API or skill, do not read or change any",
    "repository, and do not try to fix this yourself. You are being asked for two paragraphs, and the",
    "person will decide what to do. Acting here would be taking a decision that is theirs.",
    "",
    `What they tried: ${input.action}`,
    `On the card: ${input.cardTitle}`,
    "The error, verbatim:",
    "---",
    input.error.trim(),
    "---",
    "",
    "Assume they know their own project but not this tool's internals, and possibly not git's.",
    "Say what actually went wrong in plain words, then the most likely thing THEY can do about it —",
    "concretely, naming a command if there is one. If it looks like a bug in the board rather than",
    "something they did, say so plainly instead of inventing a workaround.",
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "meaning": "one short paragraph: what the error actually says",',
    '  "next": "one short paragraph: what they can do now",',
    '  "likely_bug": true or false',
    "}",
  ].join("\n");
}

/**
 * The category rule, shown only to the prompt that files cards nobody asked for. Pure.
 *
 * Separate from {@link tagRule} because it answers a different question and must not be allowed to
 * blur into it: the tag says WHERE the work lives, the category says WHY this card exists. Asked in
 * the same breath, a model reliably answers `test` to both and the board loses its area filter.
 */
function categoryRule(): string[] {
  return [
    "",
    "CATEGORY. Separate from the tag, and not a second guess at it: the tag says which AREA of the",
    "product the work is in, the category says WHY this card exists. Exactly one of:",
    "- test: nobody has exercised this yet — a manual pass, a missing automated test, a check to run.",
    "- feature: something the work was meant to do and does not do yet, or an acceptance criterion",
    "  left uncovered.",
    "- bug: something that looks broken or off-spec in what you just reviewed.",
    "- docs: README, CHANGELOG, an ADR, a comment that no longer matches the code.",
    "- chore: cleanup, refactoring, dependency or tooling work, a TODO left behind.",
    "Pick the one that names why the card exists, not the one that sounds most urgent.",
  ];
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
  /** The tag inventory — see {@link tagRule}. */
  tags?: string[];
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
    "Each todo becomes a new backlog card. Give it the same care as a card someone would write by",
    "hand: a spec grounded in what you just reviewed, not a bare title. Empty list if there are none.",
    ...tagRule(input.tags ?? []),
    ...categoryRule(),
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "verdict": "complete | partial | drift",',
    '  "notes": "one short paragraph: what looks done, what looks missing or off-spec",',
    '  "todos": [',
    '    { "title": "one short imperative line", "spec": "what to do and why, from the review above", "acceptance": ["…"], "tag": "…", "category": "test | feature | bug | docs | chore" }',
    "  ]",
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
  private _paneId: string | null = null;
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

  /**
   * The pane the copilot currently lives in, or null before its first request (or after it drops a
   * dead one). Public so the notification pipeline can recognise — and silence — its own traffic:
   * the copilot is a real agent with real status transitions, and without this its every internal
   * request/reset would page the operator exactly like a worker's would. Never the workspace LABEL
   * (`boardCopilotWorkspace`, operator-configurable): a pane id is the one identity that can't be
   * renamed out from under this check.
   */
  get paneId(): string | null {
    return this._paneId;
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
      if (!this._paneId) return null;
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
      await promptAndConfirm(this.herdr, this._paneId, buildPrompt(rel), undefined, {
        firstAfterLaunch: first,
      });
      const answer = await this.awaitFile(abs);
      if (answer === null) {
        console.warn(`[copilot] no answer at ${rel} within the deadline — see pane ${this._paneId}`);
      }
      return answer;
    } catch (err) {
      // Never rethrow — the copilot is optional by design — but never go quiet either. A silent
      // catch here is exactly what made a swallowed first prompt take an hour to find.
      console.warn(`[copilot] request failed: ${(err as Error).message}`);
      // The pane may be the problem; drop it so the next request rebuilds one.
      this._paneId = null;
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
    if (this._paneId) return;
    await mkdir(this.workDir, { recursive: true, mode: 0o700 });

    const snap = this.snapshot();
    const mine = (paneId: string) => snap.agents.some((a) => a.paneId === paneId);
    const here = [...snap.agents, ...snap.shellPanes].filter((p) => p.cwd === this.workDir);

    // An agent already running in our directory IS the copilot — reuse it as-is.
    const running = here.find((p) => mine(p.paneId));
    if (running) {
      this._paneId = running.paneId;
      console.log(`[copilot] adopted the existing agent in ${running.paneId}`);
      return;
    }

    // A bare shell left over from a previous life: relaunch into it rather than stacking another
    // workspace next to it.
    const label = this.cfg.boardCopilotWorkspace;
    const shell = here[0];
    const paneId =
      shell?.paneId ?? (await this.herdr.createWorkspace({ cwd: this.workDir, label })).paneId;

    const kind = this.cfg.boardCopilotKind || this.cfg.boardAgentKind;
    await launchAgent(this.herdr, paneId, kind, agentNameFor(label));
    this._paneId = paneId;
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
    if (!this._paneId || !clear) return;
    try {
      await promptAndConfirm(this.herdr, this._paneId, clear);
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
    if (!this._paneId || snap.bridge === "disconnected") return;
    const live = [...snap.agents, ...snap.shellPanes].some((p) => p.paneId === this._paneId);
    if (!live) this._paneId = null;
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
  /**
   * Cards the copilot is working on RIGHT NOW — a reformulation or a review in flight.
   *
   * In memory on purpose, and the fork's rule is the reason: this is runtime state, so it must not
   * be persisted. It is also honest that way — a bridge restart cancels whatever was in flight, and
   * an in-memory set forgets it exactly when it stops being true. (The wrapup marker is the opposite
   * case and lives in a column: there the work continues in an agent that outlives the bridge.)
   */
  private readonly busyCards = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly copilot: Copilot,
    private readonly cfg: Config,
  ) {}

  /**
   * Which cards are waiting on the copilot. Read into the card view so the board can say "the
   * copilot has this" instead of showing a card that is inexplicably still a bare title — the one
   * thing that looks identical to a copilot that is switched off, or that died.
   */
  busy(): ReadonlySet<string> {
    return this.busyCards;
  }

  /** Passthrough to {@link Copilot.paneId} — the snapshot route only holds this coordinator, not the
   *  raw `Copilot`, so this is how it learns which pane to keep out of the notify pipeline. */
  get paneId(): string | null {
    return this.copilot.paneId;
  }

  /**
   * Turn a card's raw brain dump into a real card, in the background.
   *
   * Background is the point: creating a card must be instant on a phone, and a reformulation is an
   * agent turn. The card exists immediately with a derived title; this fills it in a minute later and
   * the board picks it up on the next poll.
   *
   * IT DOES OVERWRITE the title, spec and acceptance — that is what a re-run is FOR, and on create
   * there is nothing there but a derived title anyway. What it must never do is lose the previous
   * text, so the replaced values go into the card's journal (`copilot.reformulated`), which the card
   * view already renders. The branch is the one field held back: a worktree may exist at it.
   */
  async reformulate(cardId: string, source?: string): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!this.copilot.enabled) return;
    // On create the raw dump is the input; a re-run may be asked for a card that never had one, and
    // then the spec is what there is to work from.
    const input = source ?? card?.rawInput;
    if (!card || !input?.trim()) return;
    this.busyCards.add(cardId);
    try {
      await this.rewrite(cardId, input);
    } finally {
      this.busyCards.delete(cardId);
    }
  }

  /**
   * Apply one free-text correction to a card, in the background.
   *
   * The counterpart to {@link reformulate}, and deliberately NOT the same call: this works from the
   * card as it stands, so it fixes the sentence that came out wrong without discarding the nine that
   * didn't. Reformulating re-reads the dictation, which for a card you have since edited (or split)
   * is the destructive answer to "just say the format is JSON".
   *
   * Background and fire-and-forget like every other copilot call — the card rewrites itself on a
   * later poll, and nothing breaks if the answer never comes.
   */
  async refine(cardId: string, instruction: string): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!this.copilot.enabled || !card || !instruction.trim()) return;
    this.busyCards.add(cardId);
    try {
      const parsed = await this.copilot.ask((out) =>
        refinePrompt({
          title: card.title,
          spec: card.spec,
          acceptance: card.acceptance,
          instruction,
          outPath: out,
        }),
      );
      const result = toReformulation(parsed);
      if (!result) {
        this.db.recordEvent(cardId, "copilot.refine_failed", { instruction });
        return;
      }
      if (!this.db.getCard(cardId)) return;
      // The answer is the whole card, so patching the three written fields IS applying it. Nothing is
      // lost: patchCard journals what each one replaced, which is what makes this revertable by the
      // same tap a hand edit is. Branch, tag and filing are untouched — a correction rewords, it does
      // not refile (same rule as a reformulation).
      this.db.patchCard(
        cardId,
        {
          ...(result.title ? { title: result.title } : {}),
          ...(result.spec ? { spec: result.spec } : {}),
          ...(result.acceptance ? { acceptance: result.acceptance } : {}),
        },
        "copilot",
      );
      this.db.recordEvent(cardId, "copilot.refined", { instruction });
    } finally {
      this.busyCards.delete(cardId);
    }
  }

  /**
   * The cards a new one could be a duplicate OF: same repo, not itself, not a container, not
   * archived.
   *
   * `done` cards are kept deliberately — "you already did this last week" is the most useful
   * duplicate there is, and the one a person is least likely to remember. Containers are dropped
   * because they hold no work of their own. Capped, newest first, because this rides in a prompt and
   * a board of four hundred cards would push the note itself out of the model's attention.
   */
  private duplicateCandidates(cardId: string): { id: string; title: string; status: string }[] {
    const card = this.db.getCard(cardId);
    if (!card) return [];
    return this.db
      .listCards()
      .filter(
        (c) =>
          c.id !== cardId &&
          c.repoPath === card.repoPath &&
          c.status !== "archived" &&
          this.db.listChildren(c.id).length === 0,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, DUPLICATE_CANDIDATES)
      .map((c) => ({ id: c.id, title: c.title, status: c.status }));
  }

  /**
   * Is the id the copilot answered with a card this one could actually repeat?
   *
   * The model is echoing back an id it was shown, so this checks the board rather than the shape: it
   * must exist, not be the card itself, and be in the same repo. An unverified id here would put a
   * dead link on a card, which is worse than no link at all.
   */
  private validDuplicate(cardId: string, target: string | undefined): boolean {
    if (!target || target === cardId) return false;
    const [card, other] = [this.db.getCard(cardId), this.db.getCard(target)];
    return !!card && !!other && other.repoPath === card.repoPath;
  }

  /**
   * Explain a raw tool error, in the background, into the card's journal.
   *
   * Background for the same reason reformulation is: this is an agent turn, and the copilot is
   * serialised to one request — a phone cannot hold a request open behind whatever else is queued.
   * The answer lands as a `copilot.explained` event, which the card screen already renders, so there
   * is no new column and nothing to clean up if it never comes.
   */
  async explain(cardId: string, input: { action: string; error: string }): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!this.copilot.enabled || !card) return;
    this.busyCards.add(cardId);
    try {
      const parsed = await this.copilot.ask((out) =>
        explainPrompt({ action: input.action, error: input.error, cardTitle: card.title, outPath: out }),
      );
      const result = toExplanation(parsed);
      if (!result) {
        this.db.recordEvent(cardId, "copilot.explain_failed", { action: input.action });
        return;
      }
      this.db.recordEvent(cardId, "copilot.explained", {
        action: input.action,
        meaning: result.meaning ?? null,
        next: result.next ?? null,
        likelyBug: result.likelyBug ?? false,
      });
    } finally {
      this.busyCards.delete(cardId);
    }
  }

  /** The body of a reformulation, split out only so the busy marker above brackets all of it. */
  private async rewrite(cardId: string, input: string): Promise<void> {
    const siblings = this.duplicateCandidates(cardId);
    const tags = this.db.listTags();
    const parsed = await this.copilot.ask((out) => reformulatePrompt(input, out, siblings, tags));
    const result = toReformulation(parsed);
    if (!result) {
      this.db.recordEvent(cardId, "copilot.reformulate_failed", {});
      return;
    }
    const fresh = this.db.getCard(cardId);
    if (!fresh) return;
    // RE-SPLITTING. A re-run on a container is asked for precisely because the split was wrong, so
    // refusing to touch it outright would decline the one thing that button is for — but blindly
    // splitting again would duplicate every sub-task. So: replace the old children only while they
    // are all still untouched, which is exactly the case that matters (you split it a minute ago
    // and it came out wrong). One started sub-task and the whole split is kept, because a card with
    // a worktree, a session or a diff behind it is not something a second opinion gets to delete.
    const existing = this.db.listChildren(cardId);
    const started = existing.filter((c) => !this.isUntouched(c));
    const mayResplit = existing.length === 0 || started.length === 0;
    const split = mayResplit ? result.split : undefined;
    const isContainer = (split?.length ?? 0) > 0;
    // A tag already on the card was put there by a person, and a reformulation is a second opinion on
    // the WORDING, not on the filing — same rule as `branch` below. So the copilot's tag only ever
    // fills a hole, and whatever ends up on the container is what its children inherit.
    const cardTag = fresh.tag ?? pickTag(result.tag, tags);
    if (existing.length > 0 && !mayResplit) {
      this.db.recordEvent(cardId, "copilot.split_kept", {
        children: existing.length,
        started: started.map((c) => c.title),
      });
    }

    this.db.patchCard(
      cardId,
      {
        ...(result.title ? { title: result.title } : {}),
        // The spec starts life as a copy of the dump, so replacing it is an improvement, not a loss
        // — and rawInput keeps the original either way.
        ...(result.spec ? { spec: result.spec } : {}),
        ...(result.acceptance ? { acceptance: result.acceptance } : {}),
        // A branch the card already has is load-bearing (a worktree may exist at it) — never touch
        // it. A container gets none at all: it is not startable, and a branch on it would only ever
        // be a name nobody checks out.
        ...(result.branchName && !fresh.branch && !isContainer
          ? { branch: `${this.cfg.boardBranchPrefix}${slugBranch(result.branchName)}` }
          : {}),
        ...(cardTag && !fresh.tag ? { tag: cardTag } : {}),
        // Only ever set on a single card: which of four freshly split sub-tasks a duplicate would
        // refer to is a question the answer doesn't contain, and guessing it would be worse than
        // saying nothing.
        ...(!isContainer && this.validDuplicate(cardId, result.duplicateOf)
          ? { duplicateOf: result.duplicateOf! }
          : {}),
      },
      // What the journal shows as the cause — and what makes the resulting `card.edited` revertable
      // by the same route a hand edit is. patchCard records what was replaced; nothing to do here.
      "copilot",
    );
    this.db.recordEvent(cardId, "copilot.reformulated", {
      title: result.title,
      acceptance: result.acceptance?.length ?? 0,
      split: split?.length ?? 0,
      ...(this.validDuplicate(cardId, result.duplicateOf) ? { duplicateOf: result.duplicateOf } : {}),
    });
    if (!isContainer) return;

    // Replacing a split means removing what it replaces. Reached only when every existing child was
    // untouched (see above), so nothing with a worktree or a session behind it can be deleted here.
    for (const child of existing) this.db.deleteCard(child.id);

    // A dump that is plainly several tasks becomes several cards, in the backlog, for you to
    // triage — each a whole card, and each pointing back at the one it came from.
    //
    // Positions are assigned explicitly and increasing: createCard's default puts a new card at the
    // TOP of its column, which applied three times in a row would show the chain backwards.
    const ids: string[] = [];
    for (const [i, task] of split!.entries()) {
      const child = this.db.createCard({
        title: task.title,
        spec: task.spec ?? null,
        acceptance: task.acceptance ?? [],
        status: "backlog",
        repoPath: fresh.repoPath,
        baseRef: fresh.baseRef,
        parentId: fresh.id,
        // Backward-only by construction (see toSplit), so the predecessor's id always exists here.
        dependsOn: task.dependsOn === undefined ? null : (ids[task.dependsOn] ?? null),
        // Falls back to the container's: sub-tasks of one theme share its area of work, and a
        // half-tagged split is the one outcome that makes the filter lie about what it holds.
        tag: pickTag(task.tag, tags) ?? cardTag,
        position: fresh.position + i + 1,
      });
      ids.push(child.id);
      this.db.recordEvent(child.id, "card.split_from", {
        parentId: fresh.id,
        ...(task.dependsOn === undefined ? {} : { after: split![task.dependsOn]?.title }),
      });
    }
  }

  /**
   * Has this card had nothing happen to it yet? The test that decides whether a re-split may delete
   * it, so it is deliberately conservative: a branch, a session or anything past `ready` all count
   * as touched, and only a card that is still exactly as the split left it may go.
   *
   * `branch` matters even without a session — `startCard` records it before launching the agent, so
   * a card whose start failed still owns a worktree on disk.
   */
  private isUntouched(card: Card): boolean {
    if (card.status !== "backlog" && card.status !== "ready") return false;
    if (card.branch !== null || card.workspaceId !== null) return false;
    return this.db.listSessions(card.id).length === 0 && this.db.listChildren(card.id).length === 0;
  }

  /**
   * Review every card whose work has landed and that hasn't been reviewed for THIS session. Keyed on
   * the session, so a card handed off and finished again gets reviewed again.
   *
   * "Landed" is two things: an agent that finished its turn (`review`), and a card the operator
   * filed as `done` — the second matters because that is the only path that carries the agent's
   * closing note, and because a review that only ever fired on `review` was a race until 0.40.1.
   *
   * This is what closes the loop: the `todos` become cards, so the board refills itself from what
   * the agents left undone.
   */
  update(snap: EngineSnapshot, statFor: (cardId: string) => Promise<string>): void {
    this.copilot.observe(snap);
    if (!this.copilot.enabled || snap.bridge === "disconnected") return;

    for (const card of this.db.listReviewableCards()) {
      if (this.busyCards.has(card.id)) continue;
      const session = this.db.openSessionFor(card.id) ?? this.db.listSessions(card.id).at(-1);
      if (!session) continue;
      if (this.db.listReviews(card.id).some((r) => r.sessionId === session.id)) continue;
      // A card filed as done is still owed its agent's closing note — reviewing before it lands
      // would judge the work on the diff alone and lose the one account of what was left undone.
      // The wrapup coordinator clears the marker either way, so this never waits forever.
      if (card.status === "done" && isPendingWrapup(session)) continue;

      this.busyCards.add(card.id);
      void this.review(card.id, session.id, statFor)
        .catch(() => {})
        .finally(() => this.busyCards.delete(card.id));
    }
  }

  /**
   * Re-run the review on demand, past the dedupe in {@link update}.
   *
   * That dedupe is per session — one review per card per session, which is right for the poll and
   * wrong for the one case a person asks: the review judged the work from the WRONG BASE REF, said
   * "nothing changed", and the base has just been corrected. Same request, same queue, same
   * fire-and-forget; only the "already reviewed" test is skipped. `busyCards` still holds, so a
   * double tap costs one agent turn.
   */
  async reviewNow(cardId: string, statFor: (cardId: string) => Promise<string>): Promise<void> {
    if (!this.copilot.enabled || this.busyCards.has(cardId)) return;
    const session = this.db.openSessionFor(cardId) ?? this.db.listSessions(cardId).at(-1);
    this.busyCards.add(cardId);
    try {
      await this.review(cardId, session?.id ?? null, statFor);
    } finally {
      this.busyCards.delete(cardId);
    }
  }

  private async review(
    cardId: string,
    sessionId: string | null,
    statFor: (cardId: string) => Promise<string>,
  ): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!card) return;
    const session = sessionId ? this.db.getSession(sessionId) : null;
    const statSummary = await statFor(cardId);
    const tags = this.db.listTags();
    const parsed = await this.copilot.ask((out) =>
      reviewPrompt({
        title: card.title,
        spec: card.spec,
        acceptance: card.acceptance,
        statSummary,
        handoffMd: session?.handoffMd ?? null,
        outPath: out,
        tags,
      }),
    );
    const result = toReviewResult(parsed);
    if (!result) {
      this.db.recordEvent(cardId, "copilot.review_failed", { sessionId });
      return;
    }
    // The loop closes here: what the agent left in plan becomes the next cards. A full card, not a
    // bare title — see the warning on SplitTask. Created BEFORE the review record so the review can
    // link to what it produced — the card the user taps through to from "N follow-ups added".
    //
    // Only once the operator has opted into it (`autoFollowUps`, off by default): a review is worth
    // having for its verdict and notes alone, and a board that refills itself is not what everyone
    // wants.
    // ponytail: the suggestions are dropped, not stored card-less — a `cardId: null` todo renders as
    // "deleted since" (struck through). Keep them if that ever gets its own rendering.
    const suggested = this.db.autoFollowUps() ? (result.todos ?? []) : [];
    const todos: ReviewTodo[] = suggested.map((todo) => {
      const created = this.db.createCard({
        title: todo.title,
        spec: todo.spec ?? null,
        acceptance: todo.acceptance ?? [],
        status: "backlog",
        repoPath: card.repoPath,
        baseRef: card.baseRef,
        // The one place a card appears with nobody asking: the review runs hours later, while you
        // are somewhere else. Nothing else on the card would say so — a split doesn't get this,
        // because you dictated it and `parentId` already points at the dump it came out of.
        origin: "copilot",
        // …and WHICH card it came out of. "Test the feature" is unreadable on its own six hours
        // later; with the reviewed card's title under it, it is a sentence. NOT `parentId`, which
        // would turn the reviewed card into a container: unstartable, and its column dragged around
        // by its own follow-ups.
        originCardId: card.id,
        // A follow-up to reviewed work lives in the same area as the work — the reviewed card's tag
        // is the better default than none, and the copilot only overrides it when it says otherwise.
        tag: pickTag(todo.tag, tags) ?? card.tag,
        // …and WHY it exists, on the same card and on a different axis (see CardCategory). Never
        // inherited from the reviewed card the way the tag is: the area is shared, the reason is not
        // — and never null, because "an automatic card with no category" is the state this whole
        // field exists to abolish.
        category: pickCategory(todo.category),
      });
      return { title: todo.title, cardId: created.id };
    });
    this.db.createReview({
      cardId,
      sessionId,
      verdict: result.verdict ?? null,
      notes: result.notes ?? null,
      todos,
    });
  }
}
