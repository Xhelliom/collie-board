// The keys a card body may carry on `POST /api/cards` and `PATCH /api/cards/<id>`, and the refusal
// for any other one.
//
// An unknown key used to be dropped without a word: an orchestrator sent its brief as `description`,
// got a 200, and every worker it launched started on a card with `spec: null`. A key the bridge does
// not read is now a 400 that names the key it probably meant — never an alias: `description` is
// refused, not stored as `spec`, so there stays one spelling per field.
//
// Kept beside `parseCardBody` (board-routes.ts) by hand: a field added there and not here is refused,
// which `bridge/card-fields.test.ts` catches by sending every one of these through the parser.

/** Every key `parseCardBody` (and `parseRecetteBody` under it) reads. */
export const CARD_BODY_FIELDS = [
  "title",
  "spec",
  "rawInput",
  "acceptance",
  "status",
  "position",
  "repoPath",
  "baseRef",
  "branch",
  "agentKind",
  "parentId",
  "dependsOn",
  "duplicateOf",
  "phaseId",
  "templateId",
  "pipelineId",
  "assignee",
  "tag",
  "keepWorktree",
  "category",
  "environment",
  "autoHandoff",
  "capability",
  "usageGroup",
  "manualChecks",
] as const;

const KNOWN = new Set<string>(CARD_BODY_FIELDS);

/** Names a caller plausibly reaches for that no edit distance would map to the real one. A hint only. */
const ALIASES: Record<string, string> = {
  description: "spec",
  desc: "spec",
  body: "spec",
  brief: "spec",
  details: "spec",
  content: "spec",
  prompt: "spec",
  name: "title",
  criteria: "acceptance",
  acceptancecriteria: "acceptance",
  repo: "repoPath",
  path: "repoPath",
  parent: "parentId",
  phase: "phaseId",
  template: "templateId",
  pipeline: "pipelineId",
  flow: "pipelineId",
  agent: "agentKind",
  labels: "tag",
  checks: "manualChecks",
};

/** Derived, never declared (ADR 0010, ADR 0048 §5): said as such rather than as a typo. */
const DERIVED = new Set(["origin", "originCardId", "createdBy"]);

/** Case, `_` and `-` folded away: `repo_path` and `RepoPath` are both `repoPath`. */
const fold = (s: string): string => s.toLowerCase().replace(/[_\-\s]/g, "");

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The known field `key` most likely meant, or null when nothing is close enough to suggest. */
export function closestCardField(key: string): string | null {
  const k = fold(key);
  if (ALIASES[k]) return ALIASES[k];
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of CARD_BODY_FIELDS) {
    const d = distance(k, fold(f));
    if (d < bestD) [best, bestD] = [f, d];
  }
  return bestD <= Math.max(1, Math.floor(k.length / 3)) ? best : null;
}

/** One sentence per key the body carries that the card routes do not read, or null when there is none. */
export function unknownCardFields(o: Record<string, unknown>): string | null {
  const unknown = Object.keys(o).filter((k) => !KNOWN.has(k));
  if (unknown.length === 0) return null;
  return unknown
    .map((k) => {
      if (DERIVED.has(k)) return `unknown field "${k}" — it is derived by the bridge, never taken from a body`;
      const hint = closestCardField(k);
      return `unknown field "${k}"${hint ? ` — did you mean "${hint}"?` : ""}`;
    })
    .join("; ");
}

/** The non-blocking word a create answers with when the card will reach its agent with no brief. */
export function createWarnings(card: { spec: string | null; rawInput: string | null }): string[] {
  return card.spec || card.rawInput ? [] : ["card has no spec: the agent will start with only its title and acceptance"];
}
