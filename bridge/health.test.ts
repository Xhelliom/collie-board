import { describe, expect, test } from "bun:test";
import type { BoardEvent, Card, Run } from "./db.ts";
import { deriveHealth, type HealthInput } from "./health.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const MIN = 60_000;

const card = (id: string, status: Card["status"], updatedAt = NOW): Card => ({ id, title: `carte ${id}`, status, repoPath: "/r", updatedAt }) as Card;
const run = (id: string, launchedAt: number): Run => ({ id, name: `lot ${id}`, repoPath: "/r", createdAt: launchedAt, launchedAt }) as Run;
let n = 0;
const ev = (cardId: string, type: string, ts: number, payload: unknown = {}): BoardEvent => ({ id: ++n, cardId, type, ts, payload });

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  now: NOW,
  lots: [],
  cards: [],
  gateEvents: [],
  routes: [],
  bridge: { uptimeMs: 1000, lastDisconnectAt: null },
  ...over,
});

describe("deriveHealth", () => {
  test("nothing wrong → empty lists", () => {
    const h = deriveHealth(base({ cards: [{ card: card("a", "review"), events: [ev("a", "card.status", NOW - MIN)] }] }));
    expect(h.lots).toEqual([]);
    expect(h.stalls).toEqual([]);
    expect(h.gates).toEqual([]);
    expect(h.routes).toEqual([]);
    expect(h.bridge).toEqual({ uptimeMs: 1000, lastDisconnectAgoMs: null });
  });

  test("an old lot whose card was halted then orphaned keeps the halt's reason, nobody watching first", () => {
    const halted = ev("c1", "run.halted", NOW - 9 * DAY, { runId: "old", reason: "merge refused (GraphQL)" });
    const orphaned = ev("c1", "card.status", NOW - 9 * DAY + MIN, { to: "orphaned" });
    const h = deriveHealth(
      base({
        lots: [
          { run: run("fresh", NOW - DAY), members: [{ card: card("c2", "working"), events: [ev("c2", "card.status", NOW - MIN)] }], orchestrator: true },
          { run: run("old", NOW - 9 * DAY - DAY), members: [{ card: card("c1", "orphaned"), events: [orphaned, halted] }], orchestrator: false },
        ],
      }),
    );
    expect(h.lots.map((l) => l.id)).toEqual(["old", "fresh"]);
    const old = h.lots[0]!;
    expect(old.ageMs).toBe(10 * DAY);
    expect(old.lastHalt).toEqual({ reason: "merge refused (GraphQL)", ageMs: 9 * DAY });
    expect(old.lastEvent).toEqual({ type: "card.status", ageMs: 9 * DAY - MIN });
    expect(old.cards).toEqual([{ id: "c1", title: "carte c1", state: "orphaned", reason: "merge refused (GraphQL)" }]);
    expect(old.orchestrator).toBe(false);
  });

  test("a halt still holding reads as halted", () => {
    const h = deriveHealth(base({ lots: [{ run: run("l", NOW - DAY), members: [{ card: card("c", "review"), events: [ev("c", "run.halted", NOW - MIN, { runId: "l", reason: "lead muet" })] }], orchestrator: null }] }));
    expect(h.lots[0]!.cards).toEqual([{ id: "c", title: "carte c", state: "halted", reason: "lead muet" }]);
  });

  test("a review card quiet for more than 45 min is a stall; a recent one is not", () => {
    const h = deriveHealth(
      base({
        cards: [
          { card: card("quiet", "review"), events: [ev("quiet", "card.status", NOW - 50 * MIN)] },
          { card: card("busy", "review"), events: [ev("busy", "card.status", NOW - 10 * MIN)] },
          { card: card("blocked", "blocked"), events: [ev("blocked", "card.status", NOW - DAY)] },
        ],
      }),
    );
    expect(h.stalls).toEqual([{ id: "quiet", title: "carte quiet", status: "review", repo: "/r", quietMs: 50 * MIN }]);
  });

  test("gates: a timeout before a red; a green and an unrelated halt are left out", () => {
    const h = deriveHealth(
      base({
        gateEvents: [
          ev("a", "run.gate", NOW - 2 * MIN, { runId: "l", ok: false, summary: "3 tests rouges" }),
          ev("b", "run.gate", NOW - MIN, { runId: "l", ok: true }),
          ev("c", "run.halted", NOW - 3 * MIN, { runId: "l", reason: "gate could not run: timed out after 20 min" }),
          ev("d", "run.halted", NOW - MIN, { runId: "l", reason: "lead muet" }),
        ],
      }),
    );
    expect(h.gates.map((g) => [g.kind, g.cardId])).toEqual([["error", "c"], ["failed", "a"]]);
  });

  test("routes: the five slowest by max", () => {
    const routes = [1, 7, 3, 9, 5, 2].map((m) => ({ route: `GET /r${m}`, maxMs: m, avgMs: m / 2, calls: 1 }));
    expect(deriveHealth(base({ routes })).routes.map((r) => r.maxMs)).toEqual([9, 7, 5, 3, 2]);
  });
});
