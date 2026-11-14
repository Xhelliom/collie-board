// What a card cost, in tokens: the sum of every transcript its sessions wrote (rounds, flow roles,
// relances — one `session` row each), per model. A MONITOR, never a brake.
//
// A live session is re-read at most every REFRESH_MS from the engine's own update (no timer here);
// when it ends its total is written on the card as a `session.cost` event — a past fact, durable —
// and the in-memory figure is dropped. Only for an agent whose adapter says `context = true`
// (a transcript format `latestUsage()` was verified against): any other is "unknown", never 0.

import { adapterFor, type AgentAdapter } from "./adapters.ts";
import type { BoardContext } from "./board-routes.ts";
import type { BoardDb } from "./db.ts";
import { modelLabel } from "./model-label.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { TranscriptSource } from "./transcript.ts";

const REFRESH_MS = 60_000;
export const COST_EVENT = "session.cost";

export interface Tokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}
export interface ModelTokens {
  model: string;
  tokens: Tokens;
}
export interface CardCost {
  tokens: Tokens;
  byModel: (ModelTokens & { label: string })[];
  /** Every session of the card. */
  sessions: number;
  /** How many of them have a figure; below `sessions`, the total is a floor, not the whole. */
  counted: number;
  known: boolean;
  partial: boolean;
}

const zero = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const add = (a: Tokens, b: Tokens): void => {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Per-model token sums of one Claude transcript. Pure. A message streamed over several rows shares
 * one `message.id`: it is counted once, from its newest row. Sidechain (subagent) turns count —
 * they are spent too. `<synthetic>` rows are not model calls.
 */
export function sumTranscript(text: string): ModelTokens[] {
  const seen = new Map<string, { model: string; tokens: Tokens }>();
  let anon = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let row: { type?: unknown; message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> } };
    try {
      row = JSON.parse(line);
    } catch {
      continue; // a partial trailing write
    }
    const m = row.message;
    if (row.type !== "assistant" || !m || typeof m !== "object" || !m.usage || typeof m.usage !== "object") continue;
    if (typeof m.model !== "string" || m.model.startsWith("<")) continue;
    const u = m.usage;
    seen.set(typeof m.id === "string" ? m.id : `#${anon++}`, {
      model: m.model,
      tokens: {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
        cacheRead: num(u.cache_read_input_tokens),
      },
    });
  }
  const byModel = new Map<string, Tokens>();
  for (const { model, tokens } of seen.values()) add(byModel.get(model) ?? byModel.set(model, zero()).get(model)!, tokens);
  return [...byModel].map(([model, tokens]) => ({ model, tokens }));
}

/** The card's total over its sessions' per-model sums (null: a session with no figure). `known` false when none is, or an agent is unverified; `partial` when only some are. */
export function foldCost(parts: (ModelTokens[] | null)[], verified: boolean): CardCost {
  const tokens = zero();
  const byModel = new Map<string, Tokens>();
  const counted = parts.filter((p) => p).length;
  for (const part of parts)
    for (const { model, tokens: t } of part ?? []) {
      add(tokens, t);
      add(byModel.get(model) ?? byModel.set(model, zero()).get(model)!, t);
    }
  return {
    tokens,
    byModel: [...byModel].map(([model, t]) => ({ model, label: modelLabel(model) ?? model, tokens: t })),
    sessions: parts.length,
    counted,
    known: verified && counted > 0,
    partial: counted < parts.length,
  };
}

export class CostTracker {
  /** sessionId → what its transcript summed to the last time it was read. Memory only. */
  private readonly live = new Map<string, { at: number; sessionId: string; path: string; usage: ModelTokens[]; complete: boolean }>();

  constructor(
    private readonly db: BoardDb,
    private readonly source: TranscriptSource,
    private readonly adapters: Record<string, AgentAdapter> = {},
    private readonly now: () => number = Date.now,
  ) {}

  async update(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected") return;
    const open = this.db.listOpenSessions();
    const openIds = new Set(open.map((s) => s.id));
    const now = this.now();
    // Ended since the last look: write the total down once, then forget it.
    for (const [id, entry] of [...this.live]) {
      if (openIds.has(id)) continue;
      this.live.delete(id);
      const session = this.db.getSession(id);
      if (!session) continue;
      try {
        const { text, complete } = await this.source.load(entry.path);
        this.db.recordEvent(session.cardId, COST_EVENT, { sessionId: id, byModel: sumTranscript(text), complete });
      } catch {
        this.db.recordEvent(session.cardId, COST_EVENT, { sessionId: id, byModel: entry.usage, complete: entry.complete });
      }
    }
    await Promise.all(
      open.map(async (s) => {
        if (!adapterFor(this.adapters, s.agentKind ?? "").context) return;
        const last = this.live.get(s.id);
        if (last && now - last.at < REFRESH_MS) return;
        const sessionId = s.agentSessionId ?? snap.agents.find((p) => p.paneId === s.paneId)?.agentSessionId ?? null;
        if (!sessionId) return; // never guess a log by directory: a wrong total is worse than none
        // Marked BEFORE the await (like ContextTracker): a failure, a missing path or a slow read
        // in flight all wait REFRESH_MS instead of being retried and overlapped at every tick.
        this.live.set(s.id, { at: now, sessionId, path: last?.path ?? "", usage: last?.usage ?? [], complete: last?.complete ?? false });
        try {
          // the agent session id can change under a card session (a resume): re-resolve then
          const path = last?.sessionId === sessionId && last.path ? last.path : await this.source.resolve(sessionId);
          if (!path) return;
          const { text, complete } = await this.source.load(path);
          this.live.set(s.id, { at: now, sessionId, path, usage: sumTranscript(text), complete });
        } catch {
          // keep the last figure
        }
      }),
    );
  }

  /** A card's cost from what the journal remembers plus what is live. Sync: the route is cheap. */
  forCard(cardId: string): CardCost {
    // A head-clipped transcript (complete:false) is a floor, not the session's total: not counted.
    const recorded = new Map<string, ModelTokens[] | null>();
    for (const e of this.db.listEventsOf(cardId, [COST_EVENT])) {
      const p = e.payload as { sessionId?: string; byModel?: ModelTokens[]; complete?: boolean } | null;
      if (p?.sessionId && Array.isArray(p.byModel)) recorded.set(p.sessionId, p.complete === false ? null : p.byModel);
    }
    const sessions = this.db.listSessions(cardId);
    const parts = sessions.map((s) => {
      if (recorded.has(s.id)) return recorded.get(s.id)!;
      const l = this.live.get(s.id);
      return l && l.complete ? l.usage : null;
    });
    const verified = sessions.length > 0 && sessions.every((s) => adapterFor(this.adapters, s.agentKind ?? "").context);
    return foldCost(parts, verified);
  }
}

const ROUTE = /^\/api\/cards\/([^/]+)\/cost$/;

/** `GET /api/cards/<id>/cost`, or null when `pathname` is not it. */
export function handleCostRoute(
  pathname: string,
  req: Request,
  ctx: Pick<BoardContext, "db" | "guard" | "json" | "text" | "cardCost">,
): Response | null {
  const m = ROUTE.exec(pathname);
  if (!m || req.method !== "GET") return null;
  const denied = ctx.guard("read");
  if (denied) return denied;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return ctx.text("not found", 404);
  }
  if (!ctx.db.getCard(id)) return ctx.text("card not found", 404);
  return ctx.json(ctx.cardCost?.(id) ?? foldCost([], false));
}
