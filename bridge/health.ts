// `GET /api/health` — what is stuck on the board, in one read, worst first: the open lots (age, last
// event, halted/orphaned/blocked cards, whether an orchestrator is alive on the repo), the cards in
// review/working that went quiet, the gates that failed or could not run in the last 24 h, the
// slowest routes since boot, and the bridge's own uptime and last Herdr disconnect.
// Derived at read time from the journal, the snapshot and route-cost — nothing stored, no loop.

import type { BoardDb, BoardEvent, Card, Run } from "./db.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { haltReason } from "./run.ts";
import { routeCostSnapshot } from "./route-cost.ts";
import type { EngineSnapshot } from "./state-engine.ts";

export const HEALTH_ROUTE = "/api/health";
export const STALL_MS = 45 * 60_000;
const GATE_WINDOW_MS = 24 * 3_600_000;
const SLOWEST = 5;

type Journal = { card: Card; events: BoardEvent[] };

export interface HealthInput {
  now: number;
  /** Open (launched, not finished) lots with their members' journals, newest event first. */
  lots: { run: Run; members: Journal[]; orchestrator: boolean | null }[];
  /** Every live card with its journal, newest first (only the head is read). */
  cards: Journal[];
  /** `run.gate` and `run.halted` events of the last 24 h. */
  gateEvents: BoardEvent[];
  routes: { route: string; avgMs: number; maxMs: number; calls: number }[];
  bridge: { uptimeMs: number; lastDisconnectAt: number | null };
}

const lastTs = (j: Journal) => j.events[0]?.ts ?? j.card.updatedAt;
const runOf = (e: BoardEvent) => (e.payload as { runId?: string } | null)?.runId;

/** The health report. Pure. */
export function deriveHealth(h: HealthInput) {
  const lots = h.lots
    .map(({ run, members, orchestrator }) => {
      const events = members.flatMap((m) => m.events);
      const last = events.reduce<BoardEvent | null>((a, e) => (!a || e.ts > a.ts ? e : a), null);
      const lastHalt = events
        .filter((e) => e.type === "run.halted" && runOf(e) === run.id)
        .reduce<BoardEvent | null>((a, e) => (!a || e.ts > a.ts ? e : a), null);
      const cards = members
        .map((m) => {
          const holding = haltReason(run, [m]);
          const halt = m.events.find((e) => e.type === "run.halted" && runOf(e) === run.id);
          const state = holding !== null ? "halted" : m.card.status === "orphaned" || m.card.status === "blocked" ? m.card.status : null;
          return state && { id: m.card.id, title: m.card.title, state, reason: holding ?? ((halt?.payload as { reason?: string } | undefined)?.reason ?? null) };
        })
        .filter((c) => c !== null);
      const since = run.launchedAt ?? run.createdAt;
      return {
        id: run.id,
        name: run.name,
        repo: run.repoPath,
        ageMs: h.now - since,
        lastEvent: last && { type: last.type, ageMs: h.now - last.ts },
        lastHalt: lastHalt && { reason: String((lastHalt.payload as { reason?: unknown }).reason ?? ""), ageMs: h.now - lastHalt.ts },
        cards,
        orchestrator,
      };
    })
    // Worst first: a stuck lot nobody watches, then a stuck one, then by how long it has been quiet.
    .sort((a, b) => score(b) - score(a) || quiet(b) - quiet(a));

  const stalls = h.cards
    .filter((j) => (j.card.status === "review" || j.card.status === "working") && h.now - lastTs(j) > STALL_MS)
    .map((j) => ({ id: j.card.id, title: j.card.title, status: j.card.status, repo: j.card.repoPath, quietMs: h.now - lastTs(j) }))
    .sort((a, b) => b.quietMs - a.quietMs);

  const gates = h.gateEvents
    .flatMap((e): { kind: "failed" | "error"; cardId: string | null; runId: string | null; detail: string; ageMs: number }[] => {
      const p = e.payload as { runId?: string; ok?: boolean; summary?: string; reason?: string; command?: string };
      if (e.type === "run.gate" && p.ok === false) return [{ kind: "failed", cardId: e.cardId, runId: p.runId ?? null, detail: p.summary ?? p.command ?? "", ageMs: h.now - e.ts }];
      if (e.type === "run.halted" && p.reason?.startsWith("gate could not run")) return [{ kind: "error", cardId: e.cardId, runId: p.runId ?? null, detail: p.reason, ageMs: h.now - e.ts }];
      return [];
    })
    // A gate that could not give a verdict (timeout) is the operator's: before a red the worker owns.
    .sort((a, b) => Number(b.kind === "error") - Number(a.kind === "error") || a.ageMs - b.ageMs);

  const routes = [...h.routes]
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, SLOWEST)
    .map(({ route, maxMs, avgMs, calls }) => ({ route, maxMs, avgMs, calls }));

  return {
    lots,
    stalls,
    gates,
    routes,
    bridge: { uptimeMs: h.bridge.uptimeMs, lastDisconnectAgoMs: h.bridge.lastDisconnectAt === null ? null : h.now - h.bridge.lastDisconnectAt },
  };
}

type Lot = { cards: unknown[]; orchestrator: boolean | null; lastEvent: { ageMs: number } | null; ageMs: number };
const score = (l: Lot) => (l.cards.length > 0 ? 2 : 0) + (l.orchestrator === false ? 1 : 0);
const quiet = (l: Lot) => l.lastEvent?.ageMs ?? l.ageMs;

/** Gather the input from the live board. A disconnected snapshot says nothing about orchestrators (null). */
export function collectHealth(
  db: Pick<BoardDb, "listOpenRuns" | "runMembers" | "listEvents" | "listLiveCards" | "eventsSince">,
  snap: EngineSnapshot,
  lastDisconnectAt: number | null,
  now = Date.now(),
): HealthInput {
  const journal = (card: Card): Journal => ({ card, events: db.listEvents(card.id, 200) });
  const up = snap.bridge !== "disconnected";
  const rc = routeCostSnapshot();
  return {
    now,
    lots: db.listOpenRuns().map((run) => ({
      run,
      members: db.runMembers(run.id).map(journal),
      orchestrator: up ? findOrchestrator(snap, run.repoPath) !== null : null,
    })),
    cards: db.listLiveCards().map((card) => ({ card, events: db.listEvents(card.id, 1) })),
    gateEvents: db.eventsSince(now - GATE_WINDOW_MS, ["run.gate", "run.halted"]),
    routes: rc.routes,
    bridge: { uptimeMs: rc.uptimeMs, lastDisconnectAt },
  };
}

export async function handleHealthRoute(
  pathname: string,
  req: Request,
  d: { input: () => HealthInput; guard: (level: "read") => Response | null; json: (data: unknown) => Response; text: (body: string, status: number) => Response },
): Promise<Response | null> {
  if (pathname !== HEALTH_ROUTE) return null;
  if (req.method !== "GET") return d.text("method not allowed", 405);
  return d.guard("read") ?? d.json(deriveHealth(d.input()));
}
