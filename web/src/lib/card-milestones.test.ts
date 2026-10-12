import { cardMilestones } from "./card-milestones";
import type { BoardEvent } from "./board";

let id = 0;
const ev = (type: string, payload: unknown = {}): BoardEvent => ({ id: ++id, cardId: "c", type, payload, ts: id * 1000 });
// The journal arrives newest first.
const journal = (...oldestFirst: BoardEvent[]) => [...oldestFirst].reverse();

describe("cardMilestones", () => {
  it("an open, unmerged PR ends the timeline on 'pull request opened'", () => {
    const m = cardMilestones(journal(ev("card.created"), ev("session.opened"), ev("card.pr_opened", { url: "u" })));
    expect(m.map((x) => x.kind)).toEqual(["started", "prOpened"]);
    expect(m.at(-1)!.tone).toBe("plain");
  });

  it("a merged PR adds 'merged' after it", () => {
    const m = cardMilestones(journal(ev("card.pr_opened"), ev("card.pr_merged")));
    expect(m.map((x) => x.kind)).toEqual(["prOpened", "prMerged"]);
    expect(m.at(-1)!.tone).toBe("good");
  });

  it("folds three lead round-trips into one expandable milestone", () => {
    const send = () => ev("run.decision", { decision: "prompt", reason: "r", prompt: "p" });
    const m = cardMilestones(journal(ev("session.opened"), send(), ev("run.gate", { ok: false, command: "t" }), send(), send()));
    const back = m.find((x) => x.kind === "sentBack")!;
    expect(back.count).toBe(3);
    expect(back.events).toHaveLength(3);
    expect(m.filter((x) => x.kind === "sentBack")).toHaveLength(1);
  });

  it("a red gate is a 'bad' milestone and only the newest gate counts", () => {
    const m = cardMilestones(journal(ev("run.gate", { ok: true, command: "t" }), ev("run.gate", { ok: false, command: "t" })));
    const gates = m.filter((x) => x.kind === "gate");
    expect(gates).toHaveLength(1);
    expect(gates[0]!.tone).toBe("bad");
  });

  it("returns nothing for noise only", () => {
    expect(cardMilestones(journal(ev("card.edited"), ev("agent.notify")))).toEqual([]);
  });
});
