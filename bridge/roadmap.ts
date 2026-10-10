// The roadmap's pure half — ADR 0021 and 0023: validating an untrusted body into the document the db
// stores, and rendering it as Markdown for the caller to commit. The bridge never writes that file:
// the export is one way, board to repo, and nothing reads it back.
//
// Two exports, one source each. The DETAILED roadmap is the authored document (vision, phases with
// their long form, the decision journal). The STEP-BY-STEP roadmap is not authored at all: it is the
// board's own phases, lots and cards rendered in order, so it cannot drift from them.

import {
  DECISION_STATUSES,
  ROADMAP_MAX_DECISIONS,
  ROADMAP_STATUSES,
  type Card,
  type Decision,
  type DecisionStatus,
  type Phase,
  type Roadmap,
  type RoadmapItem,
  type RoadmapStatus,
  type Run,
} from "./db.ts";

const MAX_ITEMS = 200;
const MAX_VISION = 20_000;
const MAX_NAME = 200;
const MAX_GOAL = 2_000;
const MAX_DETAIL = 20_000;
const MAX_DECISION = 2_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** One decision as the routes accept it. `id` absent means a new one. */
export function parseDecision(v: unknown): Parsed<Omit<Decision, "id"> & { id?: string }> {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  if (typeof o.text !== "string" || o.text.trim() === "" || o.text.length > MAX_DECISION) return { ok: false, error: "a decision needs a short text" };
  if (!DECISION_STATUSES.includes(o.status as DecisionStatus)) return { ok: false, error: `status must be one of ${DECISION_STATUSES.join(", ")}` };
  if (o.id !== undefined && (typeof o.id !== "string" || o.id.trim() === "")) return { ok: false, error: "bad decision id" };
  if (o.itemId !== undefined && o.itemId !== null && typeof o.itemId !== "string") return { ok: false, error: "itemId must be a roadmap item id or null" };
  return {
    ok: true,
    value: {
      ...(typeof o.id === "string" ? { id: o.id.trim() } : {}),
      text: o.text.trim(),
      status: o.status as DecisionStatus,
      itemId: (o.itemId as string | null | undefined) ?? null,
    },
  };
}

/** Shape of `PUT /api/roadmap`: `vision`, `items`, optional `decisions`, and the `revision` the caller read (0 for none). */
export function parseRoadmapBody(
  v: unknown,
): Parsed<{ repoPath: string; vision: string; items: RoadmapItem[]; decisions?: Decision[]; revision: number }> {
  if (typeof v !== "object" || v === null) return { ok: false, error: "bad body" };
  const o = v as Record<string, unknown>;
  if (typeof o.repoPath !== "string" || !o.repoPath.startsWith("/")) return { ok: false, error: "repoPath must be an absolute path" };
  if (typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 0)
    return { ok: false, error: "revision must be the whole number you read (0 for a new roadmap)" };
  const vision = o.vision ?? "";
  if (typeof vision !== "string" || vision.length > MAX_VISION) return { ok: false, error: "bad vision" };
  if (!Array.isArray(o.items) || o.items.length > MAX_ITEMS) return { ok: false, error: "items must be a list" };
  const seen = new Set<string>();
  const items: RoadmapItem[] = [];
  for (const raw of o.items as unknown[]) {
    const it = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof it.name !== "string" || it.name.trim() === "" || it.name.length > MAX_NAME) return { ok: false, error: "every item needs a name" };
    const goal = it.goal ?? "";
    if (typeof goal !== "string" || goal.length > MAX_GOAL) return { ok: false, error: "bad goal" };
    const detail = it.detail ?? "";
    if (typeof detail !== "string" || detail.length > MAX_DETAIL) return { ok: false, error: `detail must be text of at most ${MAX_DETAIL} characters` };
    const status = it.status ?? "planned";
    if (!ROADMAP_STATUSES.includes(status as RoadmapStatus)) return { ok: false, error: `status must be one of ${ROADMAP_STATUSES.join(", ")}` };
    if (it.id !== undefined && (typeof it.id !== "string" || it.id.trim() === "")) return { ok: false, error: "bad item id" };
    const id = typeof it.id === "string" ? it.id.trim() : crypto.randomUUID().slice(0, 8);
    if (seen.has(id)) return { ok: false, error: `duplicate item id ${id}` };
    seen.add(id);
    items.push({ id, name: it.name.trim(), goal: goal.trim(), status: status as RoadmapStatus, detail: detail.trim() });
  }
  let decisions: Decision[] | undefined;
  if (o.decisions !== undefined) {
    if (!Array.isArray(o.decisions) || o.decisions.length > ROADMAP_MAX_DECISIONS) return { ok: false, error: `decisions must be a list of at most ${ROADMAP_MAX_DECISIONS}` };
    const ids = new Set<string>();
    decisions = [];
    for (const raw of o.decisions as unknown[]) {
      const d = parseDecision(raw);
      if (!d.ok) return d;
      const id = d.value.id ?? crypto.randomUUID().slice(0, 8);
      if (ids.has(id)) return { ok: false, error: `duplicate decision id ${id}` };
      ids.add(id);
      decisions.push({ ...d.value, id, itemId: d.value.itemId ?? null });
    }
  }
  return { ok: true, value: { repoPath: o.repoPath, vision: vision.trim(), items, ...(decisions ? { decisions } : {}), revision: o.revision } };
}

const MARK: Record<DecisionStatus, string> = { decided: "✅ Décidé", leaning: "🟡 Piste privilégiée", open: "❓ Questions ouvertes" };

/** The DETAILED roadmap as Markdown. Pure. */
export function roadmapMarkdown(
  name: string,
  r: Pick<Roadmap, "vision" | "items" | "revision"> & { decisions?: Decision[] },
): string {
  const lines = [
    `<!-- Generated by Collie Board, revision ${r.revision}. Edit the roadmap in the board, not here. -->`,
    `# Roadmap — ${name}`,
  ];
  if (r.vision) lines.push("", r.vision);
  const title = new Map(r.items.map((it, i) => [it.id, `${i + 1}. ${it.name}`]));
  r.items.forEach((it, i) => {
    lines.push("", `## ${i + 1}. ${it.name}${it.status === "planned" ? "" : ` — ${it.status}`}`);
    if (it.goal) lines.push("", it.goal);
    if (it.detail) lines.push("", it.detail);
  });
  const decisions = r.decisions ?? [];
  if (decisions.length) {
    lines.push("", "## Décisions");
    for (const status of DECISION_STATUSES) {
      const group = decisions.filter((d) => d.status === status);
      if (!group.length) continue;
      lines.push("", `### ${MARK[status]} (${group.length})`, "");
      for (const d of group) lines.push(`- ${d.text}${d.itemId && title.has(d.itemId) ? ` — _${title.get(d.itemId)}_` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}


/**
 * The STEP-BY-STEP roadmap, rendered from the board: each phase (table order) with its lots — name,
 * planned or launched, parallelism ceiling — and their cards (status, spec, criteria, what they wait
 * for), then the phase's cards no lot has taken. Phases with no card are left out: the roadmap is
 * detailed one phase at a time, just in time. Pure.
 */
export function stepsMarkdown(name: string, board: { phases: Phase[]; lots: Run[]; cards: Card[] }): string {
  const cards = board.cards.filter((c) => c.status !== "archived");
  const byId = new Map(cards.map((c) => [c.id, c]));
  const card = (c: Card): string[] => {
    const out = [`- **${c.title}** — ${c.status}`];
    const after = c.dependsOn ? byId.get(c.dependsOn) : undefined;
    if (after) out.push(`  - after: ${after.title}`);
    if (c.spec) out.push("", ...c.spec.trim().split("\n").map((l) => `  ${l}`), "");
    for (const a of c.acceptance) out.push(`  - [${c.status === "done" ? "x" : " "}] ${a}`);
    return out;
  };
  const lines = [`# Étape par étape — ${name}`, "", "<!-- Generated by Collie Board from its phases, lots and cards. Edit them in the board, not here. -->"];
  const phases = [...board.phases].sort((a, b) => a.position - b.position);
  // A validated phase is a milestone: said in one line, its cards not listed again.
  const closed = phases.filter((p) => p.closedAt !== null);
  if (closed.length) {
    lines.push("", "## Validated phases", "");
    for (const p of closed) {
      const n = cards.filter((c) => c.phaseId === p.id).length;
      lines.push(`- **${p.name}** — validated ${new Date(p.closedAt!).toISOString().slice(0, 10)}, ${n} step${n === 1 ? "" : "s"}${p.closedNote ? ` — ${p.closedNote}` : ""}`);
    }
  }
  for (const [i, p] of phases.entries()) {
    if (p.closedAt !== null) continue;
    const mine = cards.filter((c) => c.phaseId === p.id);
    if (!mine.length) continue;
    lines.push("", `## Phase ${i + 1} — ${p.name}`);
    if (p.goal) lines.push("", p.goal);
    const lots = board.lots.filter((l) => l.phaseId === p.id).sort((a, b) => a.position - b.position);
    const taken = new Set<string>();
    for (const l of lots) {
      const own = mine.filter((c) => c.runId === l.id);
      own.forEach((c) => taken.add(c.id));
      const ceiling = l.maxParallel === null ? "" : l.maxParallel === 1 ? ", one at a time" : `, ${l.maxParallel} at a time`;
      lines.push("", `### Lot — ${l.name ?? "unnamed"} (${l.launchedAt === null ? "planned" : "launched"}${ceiling})`, "");
      own.forEach((c) => lines.push(...card(c)));
    }
    const loose = mine.filter((c) => !taken.has(c.id));
    if (loose.length) {
      lines.push("", lots.length ? "### Not in a lot" : "### Cards", "");
      loose.forEach((c) => lines.push(...card(c)));
    }
  }
  return lines.join("\n") + "\n";
}

