import { describe, expect, it } from "vitest";

import { actorOf, criterionVerdicts, ficheState, historyRows } from "./card-fiche";
import type { BoardEvent } from "./board";

const ev = (id: number, type: string, payload: unknown = {}): BoardEvent => ({ id, cardId: "c", type, payload, ts: id * 1000 });
const runtime = { paneId: "p", agent: "claude", agentStatus: "working" as const, cwd: "/", workspaceId: "w", workspaceLabel: "w" };

describe("ficheState", () => {
  it("reads the four faces from the column, the pane and the lead's last word", () => {
    expect(ficheState({ status: "backlog", runtime: null }, null)).toBe("todo");
    expect(ficheState({ status: "ready", runtime: null }, null)).toBe("todo");
    expect(ficheState({ status: "working", runtime }, null)).toBe("running");
    expect(ficheState({ status: "review", runtime: null }, null)).toBe("running");
    expect(ficheState({ status: "blocked", runtime }, null)).toBe("running");
    expect(ficheState({ status: "blocked", runtime: null }, null)).toBe("stopped");
    expect(ficheState({ status: "orphaned", runtime: null }, null)).toBe("stopped");
    expect(ficheState({ status: "review", runtime }, { conclusion: { kind: "halted", reason: "x" } })).toBe("stopped");
    expect(ficheState({ status: "done", runtime: null }, { conclusion: { kind: "halted", reason: "x" } })).toBe("done");
  });
});

describe("actorOf", () => {
  const person = { origin: null, originCardId: null };
  it("names who did each thing", () => {
    expect(actorOf(ev(1, "session.opened"), person)).toBe("agent");
    expect(actorOf(ev(1, "run.decision"), person)).toBe("lead");
    expect(actorOf(ev(1, "run.gate"), person)).toBe("board");
    expect(actorOf(ev(1, "review.created"), person)).toBe("copilot");
    expect(actorOf(ev(1, "card.edited"), person)).toBe("you");
    expect(actorOf(ev(1, "card.released", { why: "expired" }), person)).toBe("board");
    expect(actorOf(ev(1, "card.pr_merged"), person)).toBe("board");
  });
  it("says who created a card from its provenance", () => {
    expect(actorOf(ev(1, "card.created"), person)).toBe("you");
    expect(actorOf(ev(1, "card.created"), { origin: "copilot", originCardId: "x" })).toBe("copilot");
    expect(actorOf(ev(1, "card.created"), { origin: "agent", originCardId: null })).toBe("orchestrator");
    expect(actorOf(ev(1, "card.created"), { origin: "agent", originCardId: "x" })).toBe("agent");
  });
});

describe("historyRows", () => {
  it("keeps the key steps only, newest first, each with its actor", () => {
    const events = [ev(1, "card.created"), ev(2, "card.worktree", { branch: "b" }), ev(3, "session.opened"), ev(4, "card.edited")];
    const rows = historyRows(events, events, { origin: null, originCardId: null }, (e) => e.type, (n) => `back ${n}`);
    expect(rows.map((r) => [r.id, r.actor])).toEqual([
      [4, "you"],
      [3, "agent"],
      [1, "you"],
    ]);
  });
});

describe("criterionVerdicts", () => {
  const criteria = ["Colonnes en français avec bande vide", "Tuile en trois lignes", "Téléphone conforme"];
  it("reads one line per criterion, by its number or its first words", () => {
    const report = [
      "## Criteria",
      "1. Colonnes en français — met, checked in the test",
      "- **Tuile en trois lignes**: partly met, no phone check",
      "Nothing else.",
    ].join("\n");
    const v = criterionVerdicts(criteria, [report]);
    expect(v[0]?.verdict).toBe("met");
    expect(v[1]?.verdict).toBe("partial");
    expect(v[2]).toBeNull();
  });
  it("gives no verdict rather than a guess", () => {
    expect(criterionVerdicts(criteria, ["1. Colonnes en français, see the diff"])[0]).toBeNull();
    expect(criterionVerdicts(criteria, [null])).toEqual([null, null, null]);
  });
  it("tells « not met » from « met »", () => {
    expect(criterionVerdicts(criteria, ["3) Téléphone conforme : non atteint"])[2]?.verdict).toBe("not");
  });
});
