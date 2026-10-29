// The recette: what the operator can test by hand at the end of the day, once lots have run.
//
// Structured data on the card, not an HTML file: a page served by the bridge is scrubbed and
// sandboxed (no interactivity), and one file edited by two pairs conflicts in git where the journal
// does not. The steps are the card's to write (its agent, the orchestrator, the operator — PATCH);
// the verdict is the operator's alone — an agent does not pass its own recette.
//
// It reads as USE, not as code: an entry is titled by what the user can now do, grouped by the use it
// serves, and says nothing the project page already shows (PR, diff, files). A card with no step —
// purely internal work — is simply absent.

import { join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { deliverablesRoot, listDeliverables, servedAs } from "./deliverables.ts";
import { CHECK_STATUSES, EVENT_WINDOW, type Card, type CardPatch, type CheckStatus, type ManualCheck } from "./db.ts";

/** One line a person reads at a glance: verb + where + what to expect. */
export const CHECK_TEXT_MAX = 100;
const MAX_CHECKS = 10;

/**
 * Validate the recette fields of an untrusted card body. A step without an id gets one from its text,
 * so rewriting the same step keeps its verdict and rewording it asks for a fresh one.
 */
export function parseRecetteBody(
  o: Record<string, unknown>,
): { ok: true; value: Pick<CardPatch, "manualChecks" | "capability" | "usageGroup"> } | { ok: false; error: string } {
  const out: Pick<CardPatch, "manualChecks" | "capability" | "usageGroup"> = {};
  for (const key of ["capability", "usageGroup"] as const) {
    if (!(key in o)) continue;
    const v = o[key];
    if (v !== null && typeof v !== "string") return { ok: false, error: `bad ${key}` };
    if (typeof v === "string" && v.trim().length > CHECK_TEXT_MAX) return { ok: false, error: `${key} over ${CHECK_TEXT_MAX} chars` };
    out[key] = v === null ? null : v.trim() || null;
  }
  if (!("manualChecks" in o)) return { ok: true, value: out };
  if (!Array.isArray(o.manualChecks) || o.manualChecks.length > MAX_CHECKS) {
    return { ok: false, error: `manualChecks must be an array of at most ${MAX_CHECKS} steps` };
  }
  const steps: ManualCheck[] = [];
  for (const raw of o.manualChecks as unknown[]) {
    const s = (typeof raw === "string" ? { text: raw } : raw) as Record<string, unknown> | null;
    if (typeof s !== "object" || s === null || typeof s.text !== "string" || !s.text.trim()) return { ok: false, error: "a step needs a text" };
    const step: ManualCheck = { id: "", text: s.text.trim() };
    for (const key of ["id", "expected", "shot"] as const) {
      if (s[key] === undefined || s[key] === null) continue;
      if (typeof s[key] !== "string") return { ok: false, error: `bad step ${key}` };
      const v = (s[key] as string).trim();
      if (v) step[key] = v;
    }
    if (step.text.length > CHECK_TEXT_MAX || (step.expected?.length ?? 0) > CHECK_TEXT_MAX) {
      return { ok: false, error: `a step is one line: ${CHECK_TEXT_MAX} chars max` };
    }
    step.id ||= Bun.hash(step.text).toString(36);
    if (steps.some((x) => x.id === step.id)) return { ok: false, error: `duplicate step ${step.id}` };
    steps.push(step);
  }
  out.manualChecks = steps;
  return { ok: true, value: out };
}

export type RecetteState = "todo" | "ok" | "ko";

/** KO as soon as one step failed; OK once every step has a verdict; to test otherwise. */
export function recetteState(card: Pick<Card, "manualChecks" | "checkVerdicts">): RecetteState {
  const statuses = card.manualChecks.map((c) => card.checkVerdicts[c.id]?.status);
  if (statuses.includes("ko")) return "ko";
  return statuses.every(Boolean) ? "ok" : "todo";
}

/** The worker's closing ask, beside its bilan or its report. */
export function manualChecksPrompt(cardId: string): string {
  return [
    "If this card changes something a person can see or do, write its manual test (« recette ») on the card",
    `before you stop — 1 to 5 steps, each ONE line (≤ ${CHECK_TEXT_MAX} chars): verb + where + what to expect, in the`,
    "user's words. Never a route, a file name or a PR: the card already shows those. `capability` is what the",
    "user can now DO (« Lancer une carte sur dev depuis l'éditeur »), `usageGroup` the use it serves",
    "(« Piloter une autre machine »). A step may point at a deliverable you published: \"shot\":\"<its name>\".",
    `  curl -s -X PATCH "http://127.0.0.1:\${COLLIE_BOARD_PORT:-8788}/api/cards/${cardId}" -H 'content-type: application/json' \\`,
    `    -H "x-collie-pane: $HERDR_PANE_ID" -d '{"capability":"…","usageGroup":"…","manualChecks":[{"text":"…","expected":"…"}]}'`,
    "Purely internal work (tests, refactor, an invisible fix): write nothing.",
  ].join("\n");
}

const VERDICT_ROUTE = /^\/api\/cards\/([^/]+)\/checks\/([^/]+)$/;
const RECETTE_ROUTE = "/api/recette";

/** When a card was delivered: its merge, else its move to done, else its last write. */
function deliveredAt(ctx: BoardContext, card: Card): number {
  const events = ctx.db.listEvents(card.id, EVENT_WINDOW);
  const merged = events.filter((e) => e.type === "card.merged" || e.type === "card.pr_merged");
  const done = events.filter((e) => e.type === "card.status" && (e.payload as { to?: string } | null)?.to === "done");
  const at = (merged.length ? merged : done).map((e) => e.ts);
  return at.length ? Math.max(...at) : card.updatedAt;
}

/** `GET /api/recette` and `POST /api/cards/<id>/checks/<stepId>`, or null when `pathname` is neither. */
export async function handleRecetteRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname === RECETTE_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("read");
    if (denied) return denied;
    const q = new URL(req.url).searchParams;
    const repo = q.get("repo");
    const sinceRaw = q.get("since");
    const since = sinceRaw ? (/^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw)) : 0;
    if (Number.isNaN(since)) return ctx.text("since must be epoch ms or a date", 400);
    const all = q.get("all") === "1";
    const cards = ctx.db.listCards({ includeArchived: true });
    const delivered = (c: Card) => c.status === "done" || c.status === "archived";
    // A KO stays until the card that fixes it is delivered — then it is over too.
    const fixed = new Set(cards.filter((c) => c.originCardId && delivered(c)).map((c) => c.originCardId));
    const entries = cards
      .filter((c) => delivered(c) && c.manualChecks.length > 0 && (!repo || c.repoPath === repo))
      .map((c) => ({ card: c, at: deliveredAt(ctx, c), state: recetteState(c), followUpDone: fixed.has(c.id) }))
      .filter((e) => e.at >= since && (all || (e.state !== "ok" && !(e.state === "ko" && e.followUpDone))))
      .sort((a, b) => b.at - a.at);
    const stateDir = ctx.cfg.stateDir;
    const groups = new Map<string, unknown[]>();
    for (const { card, at, state, followUpDone } of entries) {
      // The captures lead each entry: its image deliverables, read off disk (no store: none).
      const shots = stateDir
        ? (await listDeliverables(join(deliverablesRoot(stateDir), card.id))).filter((d) => servedAs(d.name).kind === "image").map((d) => d.name)
        : [];
      const usage = card.usageGroup ?? "";
      if (!groups.has(usage)) groups.set(usage, []);
      groups.get(usage)!.push({
        cardId: card.id,
        capability: card.capability ?? card.title,
        repoPath: card.repoPath,
        assignee: card.assignee,
        state,
        followUpDone,
        shots,
        deliveredAt: at,
        phase: card.phaseId ? (ctx.db.getPhase(card.phaseId)?.name ?? null) : null,
        lot: card.runId ? (ctx.db.getRun(card.runId)?.name ?? null) : null,
        steps: card.manualChecks.map((s) => ({ ...s, verdict: card.checkVerdicts[s.id] ?? null })),
      });
    }
    return ctx.json({ groups: [...groups].map(([usage, items]) => ({ usage: usage || null, entries: items })) });
  }

  const m = VERDICT_ROUTE.exec(pathname);
  if (!m) return null;
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get("x-collie-pane")?.trim()) return ctx.text("the verdict is the operator's — an agent does not pass its own recette", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  let cardId: string, stepId: string;
  try {
    cardId = decodeURIComponent(m[1]!);
    stepId = decodeURIComponent(m[2]!);
  } catch {
    return ctx.text("not found", 404);
  }
  const card = ctx.db.getCard(cardId);
  if (!card) return ctx.text("card not found", 404);
  const step = card.manualChecks.find((s) => s.id === stepId);
  if (!step) return ctx.text("step not found", 404);
  const body = ((await req.json().catch(() => null)) ?? {}) as { status?: unknown; note?: unknown; followUp?: unknown };
  if (!CHECK_STATUSES.includes(body.status as CheckStatus)) return ctx.text(`status must be ${CHECK_STATUSES.join(", ")}`, 400);
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return ctx.text("bad note", 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const status = body.status as CheckStatus;
  if (body.followUp === true && (status !== "ko" || !note)) return ctx.text("a follow-up needs a KO with a note", 400);
  // Derived, never declared: the pair's git identity on a shared repo, the operator otherwise.
  const repo = card.repoPath;
  const by = (repo && ctx.db.repoShare(repo) && ctx.db.peerIdentity(repo)) || "operator";
  const updated = ctx.db.setCheckVerdict(cardId, stepId, { status, by, at: Date.now(), ...(note ? { note } : {}) });
  // The operator's gesture: a KO they explained becomes the card that fixes it, linked back to this one.
  const followUp =
    body.followUp === true
      ? ctx.db.createCard({
          title: `Recette KO — ${card.capability ?? card.title}`.slice(0, 200),
          spec: [`Step: ${step.text}`, step.expected ? `Expected: ${step.expected}` : null, `Observed: ${note}`].filter(Boolean).join("\n"),
          repoPath: repo,
          baseRef: card.baseRef,
          phaseId: card.phaseId,
          originCardId: card.id,
        })
      : null;
  ctx.audit.record({
    action: "card.check",
    session: ctx.session,
    device: ctx.device,
    detail: { cardId, stepId, status, ...(followUp ? { followUp: followUp.id } : {}) },
  });
  return ctx.json({ ok: true, card: updated, followUp });
}
