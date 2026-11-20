// The recette's triage: a proposal (data, not prose) that says which entries are obsolete — and which
// card now tests them — and which entries are the same gestures in the same place, to be read as one.
//
// Anyone may propose (an exploration card PUTs it); only the operator applies or undoes it — like a
// verdict, applying writes verdicts. Nothing is deleted: an obsolete step gets a « skip » verdict that
// says why (only a step with no verdict yet), a group is folded at read time in `GET /api/recette`,
// every step keeping its own card and verdict. Undo takes back the skips this triage wrote and still
// stand, and the groups fall apart: the recette reads as it did before.

import type { BoardContext } from "./board-routes.ts";
import type { BoardDb, Card, CheckVerdict } from "./db.ts";

export const TRIAGE_ROUTE = "/api/recette/triage";
const REASON_MAX = 300;
const TITLE_MAX = 200;

export interface Obsolete {
  cardId: string;
  /** Absent: the whole entry. */
  stepId?: string;
  reason: string;
  replacedBy: string[];
}

export interface TriageGroup {
  usage: string | null;
  title: string;
  /** The first is the base: the folded entry keeps its card, its thread, its PR. */
  cardIds: string[];
}

export interface TriageProposal {
  obsolete: Obsolete[];
  groups: TriageGroup[];
}

export interface RepoTriage {
  proposal: TriageProposal;
  proposedBy: string;
  proposedAt: number;
  /** Null until the operator applies it. `skipped`: the verdicts it wrote, so undo takes back exactly those. */
  applied: { by: string; at: number; skipped: { cardId: string; stepId: string; at: number }[] } | null;
}

type Store = Record<string, RepoTriage>;

const readStore = (db: BoardDb): Store => {
  try {
    const v = JSON.parse(db.recetteTriage() ?? "{}") as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
};

/** The applied triage of each repo — what `GET /api/recette` folds by. */
export function appliedTriages(db: BoardDb): Map<string, TriageProposal> {
  return new Map(Object.entries(readStore(db)).flatMap(([repo, t]) => (t.applied ? [[repo, t.proposal] as const] : [])));
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/**
 * Validate an untrusted proposal against the repo's cards: every id must be a card of the repo, every
 * step one of its steps, a card in one group at most and never both obsolete and grouped. Pure.
 */
export function parseProposal(raw: unknown, cards: ReadonlyMap<string, Pick<Card, "manualChecks">>): { ok: true; value: TriageProposal } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.obsolete) || !Array.isArray(o.groups)) return { ok: false, error: "obsolete and groups must be arrays" };
  const known = (id: unknown): id is string => typeof id === "string" && cards.has(id);
  const obsolete: Obsolete[] = [];
  for (const x of o.obsolete as Record<string, unknown>[]) {
    const reason = str(x?.reason, REASON_MAX);
    if (!known(x?.cardId)) return { ok: false, error: `unknown card ${String(x?.cardId)}` };
    if (!reason) return { ok: false, error: `obsolete ${x.cardId}: a reason (≤ ${REASON_MAX} chars) is required` };
    if (!Array.isArray(x.replacedBy) || !x.replacedBy.length || !x.replacedBy.every(known)) return { ok: false, error: `obsolete ${x.cardId}: replacedBy must name known cards` };
    if (x.stepId !== undefined && !cards.get(x.cardId)!.manualChecks.some((s) => s.id === x.stepId)) return { ok: false, error: `unknown step ${String(x.stepId)} of ${x.cardId}` };
    obsolete.push({ cardId: x.cardId, ...(typeof x.stepId === "string" ? { stepId: x.stepId } : {}), reason, replacedBy: x.replacedBy as string[] });
  }
  const wholly = new Set(obsolete.filter((x) => !x.stepId).map((x) => x.cardId));
  const grouped = new Set<string>();
  const groups: TriageGroup[] = [];
  for (const g of o.groups as Record<string, unknown>[]) {
    const title = str(g?.title, TITLE_MAX);
    if (!title) return { ok: false, error: "a group needs a title" };
    if (!Array.isArray(g.cardIds) || g.cardIds.length < 2) return { ok: false, error: `group « ${title} »: at least two cards` };
    for (const id of g.cardIds as unknown[]) {
      if (!known(id)) return { ok: false, error: `group « ${title} »: unknown card ${String(id)}` };
      if (grouped.has(id) || wholly.has(id)) return { ok: false, error: `card ${id} is in two places` };
      grouped.add(id);
    }
    groups.push({ usage: str(g.usage, TITLE_MAX), title, cardIds: g.cardIds as string[] });
  }
  return { ok: true, value: { obsolete, groups } };
}

/** What the confirm sheet says before the operator applies. Pure. */
export function triageSummary(p: TriageProposal) {
  return {
    obsolete: p.obsolete.filter((x) => !x.stepId).length,
    obsoleteSteps: p.obsolete.filter((x) => x.stepId).length,
    groups: p.groups.length,
    grouped: p.groups.reduce((n, g) => n + g.cardIds.length, 0),
  };
}

/** The steps applying would skip: the obsolete ones that have no verdict yet. Pure. */
export function stepsToSkip(p: TriageProposal, cards: ReadonlyMap<string, Pick<Card, "manualChecks" | "checkVerdicts">>): { cardId: string; stepId: string; ob: Obsolete }[] {
  return p.obsolete.flatMap((ob) => {
    const card = cards.get(ob.cardId);
    if (!card) return [];
    return card.manualChecks.filter((s) => (!ob.stepId || s.id === ob.stepId) && !card.checkVerdicts[s.id]).map((s) => ({ cardId: ob.cardId, stepId: s.id, ob }));
  });
}

/** The skips undo takes back: the ones this triage wrote that nobody has changed since. Pure. */
export function skipsToUndo(applied: NonNullable<RepoTriage["applied"]>, verdictOf: (cardId: string, stepId: string) => CheckVerdict | undefined) {
  return applied.skipped.filter((x) => {
    const v = verdictOf(x.cardId, x.stepId);
    return v?.status === "skip" && v.at === x.at;
  });
}

export interface StepOut {
  id: string;
  cardId: string;
  verdict: CheckVerdict | null;
  obsolete?: { reason: string; replacedBy: { cardId: string; title: string }[] };
  [k: string]: unknown;
}

export interface EntryOut {
  cardId: string;
  title: string;
  capability: string;
  usage: string | null;
  state: "todo" | "ok" | "ko";
  aside: boolean;
  followUpDone: boolean;
  deliveredAt: number;
  shots: string[];
  steps: StepOut[];
  [k: string]: unknown;
}

/**
 * Fold an applied triage into the recette's entries: a group becomes its base entry, carrying every
 * member's steps (each still naming its card) and captures; an obsolete entry or step says why and
 * which card replaces it. Members not in `entries` are simply absent. Pure.
 */
export function foldTriage(entries: readonly EntryOut[], p: TriageProposal, titleOf: (id: string) => string): EntryOut[] {
  const replaced = (ob: Obsolete) => ({ reason: ob.reason, replacedBy: ob.replacedBy.map((id) => ({ cardId: id, title: titleOf(id) })) });
  const marked = entries.map((e) => {
    const whole = p.obsolete.find((x) => x.cardId === e.cardId && !x.stepId);
    const steps = e.steps.map((s) => {
      const ob = p.obsolete.find((x) => x.cardId === e.cardId && x.stepId === s.id);
      return ob ? { ...s, obsolete: replaced(ob) } : s;
    });
    return { ...e, steps, ...(whole ? { obsolete: replaced(whole) } : {}) };
  });
  const byId = new Map(marked.map((e) => [e.cardId, e]));
  const absorbed = new Set<string>();
  const folded = new Map<string, EntryOut>();
  for (const g of p.groups) {
    const members = g.cardIds.map((id) => byId.get(id)).filter((e): e is EntryOut => !!e);
    if (members.length < 2) continue;
    const base = members[0]!;
    const steps = members.flatMap((m) => m.steps);
    const statuses = steps.map((s) => s.verdict?.status);
    for (const m of members.slice(1)) absorbed.add(m.cardId);
    folded.set(base.cardId, {
      ...base,
      capability: g.title,
      usage: g.usage ?? base.usage,
      steps,
      shots: members.flatMap((m) => m.shots),
      // The card each capture belongs to, index for index: its URL is that card's.
      shotCards: members.flatMap((m) => m.shots.map(() => m.cardId)),
      deliveredAt: Math.max(...members.map((m) => m.deliveredAt)),
      state: statuses.includes("ko") ? "ko" : statuses.every(Boolean) ? "ok" : "todo",
      followUpDone: members.every((m) => m.state !== "ko" || m.followUpDone),
      members: members.map((m) => ({ cardId: m.cardId, title: m.title })),
    });
  }
  return marked.filter((e) => !absorbed.has(e.cardId)).map((e) => folded.get(e.cardId) ?? e);
}

/** `GET|PUT|POST|DELETE /api/recette/triage?repo=<path>`, or null for another path. */
export async function handleTriageRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== TRIAGE_ROUTE) return null;
  const repo = new URL(req.url).searchParams.get("repo");
  if (!repo) return ctx.text("repo is required", 400);
  const store = readStore(ctx.db);
  const current = store[repo] ?? null;

  if (req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    if (!current) return ctx.json({ triage: null });
    const { proposal, proposedBy, proposedAt, applied } = current;
    return ctx.json({ triage: { proposal, proposedBy, proposedAt, applied: applied && { by: applied.by, at: applied.at, skipped: applied.skipped.length }, summary: triageSummary(proposal) } });
  }

  const pane = req.headers.get("x-collie-pane")?.trim();
  const denied = ctx.guard("write");
  if (denied) return denied;
  const save = () => ctx.db.setRecetteTriage(JSON.stringify(store));
  const cards = new Map(ctx.db.listCards({ includeArchived: true }).filter((c) => c.repoPath === repo).map((c) => [c.id, c]));

  if (req.method === "PUT") {
    // A proposal only: an agent may file it, nothing changes until the operator applies it.
    if (current?.applied) return ctx.text("a triage is applied: undo it before proposing another", 409);
    const parsed = parseProposal(await req.json().catch(() => null), cards);
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    store[repo] = { proposal: parsed.value, proposedBy: pane ? `agent ${pane}` : "operator", proposedAt: Date.now(), applied: null };
    save();
    ctx.audit.record({ action: "recette.triage_proposed", session: ctx.session, device: ctx.device, detail: { repo, ...triageSummary(parsed.value) } });
    return ctx.json({ ok: true, summary: triageSummary(parsed.value) });
  }

  if (req.method !== "POST" && req.method !== "DELETE") return ctx.text("method not allowed", 405);
  if (pane) return ctx.text("applying a triage writes verdicts — the operator's gesture, not an agent's", 403);
  if (!current) return ctx.text("no triage proposed for this repo", 404);
  const by = (ctx.db.repoShare(repo) && ctx.db.peerIdentity(repo)) || "operator";

  if (req.method === "POST") {
    if (current.applied) return ctx.text("already applied", 409);
    const at = Date.now();
    const skipped: { cardId: string; stepId: string; at: number }[] = [];
    for (const { cardId, stepId, ob } of stepsToSkip(current.proposal, cards)) {
      const names = ob.replacedBy.map((id) => `« ${cards.get(id)?.title ?? id} »`).join(", ");
      ctx.db.setCheckVerdict(cardId, stepId, { status: "skip", by, at, note: `caduque — remplacée par ${names} : ${ob.reason}` });
      skipped.push({ cardId, stepId, at });
    }
    current.applied = { by, at, skipped };
    save();
    ctx.audit.record({ action: "recette.triage_applied", session: ctx.session, device: ctx.device, detail: { repo, skipped: skipped.length, groups: current.proposal.groups.length } });
    return ctx.json({ ok: true, skipped: skipped.length });
  }

  if (!current.applied) return ctx.text("not applied", 409);
  const undone = skipsToUndo(current.applied, (cardId, stepId) => cards.get(cardId)?.checkVerdicts[stepId]);
  for (const x of undone) ctx.db.setCheckVerdict(x.cardId, x.stepId, null);
  current.applied = null;
  save();
  ctx.audit.record({ action: "recette.triage_undone", session: ctx.session, device: ctx.device, detail: { repo, restored: undone.length } });
  return ctx.json({ ok: true, restored: undone.length });
}
