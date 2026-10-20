import { AGENT_GROUPS, groupMembers, isOrchestrator } from "./agent-groups";
import type { AgentStatus, AgentView } from "./types";

const ALL_STATUSES: AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

const groupFor = (s: AgentStatus) => AGENT_GROUPS.filter((g) => g.match(s));

describe("AGENT_GROUPS", () => {
  it("has the three triage groups in needs → working → other order", () => {
    expect(AGENT_GROUPS.map((g) => g.key)).toEqual(["needs", "working", "other"]);
  });

  it("only the 'needs you' group is accented", () => {
    expect(AGENT_GROUPS.find((g) => g.key === "needs")!.accent).toBe(true);
    expect(AGENT_GROUPS.find((g) => g.key === "working")!.accent).toBeFalsy();
    expect(AGENT_GROUPS.find((g) => g.key === "other")!.accent).toBeFalsy();
  });

  it("assigns every status to exactly one group", () => {
    for (const s of ALL_STATUSES) {
      expect(groupFor(s)).toHaveLength(1);
    }
  });

  it("routes 'blocked' to 'needs you'", () => {
    expect(groupFor("blocked")[0]!.key).toBe("needs");
  });

  it("routes 'working' to 'working'", () => {
    expect(groupFor("working")[0]!.key).toBe("working");
  });

  it("routes idle / done / unknown to 'other'", () => {
    expect(groupFor("idle")[0]!.key).toBe("other");
    expect(groupFor("done")[0]!.key).toBe("other");
    expect(groupFor("unknown")[0]!.key).toBe("other");
  });
});

const pane = (paneId: string, over: Partial<AgentView> = {}): AgentView =>
  ({ paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t",
     agent: "claude", status: "idle", cwd: "/x", focused: false, kind: "agent", ...over }) as AgentView;

const other = AGENT_GROUPS.find((g) => g.key === "other")!;
const working = AGENT_GROUPS.find((g) => g.key === "working")!;

describe("groupMembers", () => {
  it("orders idle · done newest-settled first", () => {
    const panes = [pane("a", { statusSince: 100 }), pane("b", { statusSince: 300 }), pane("c", { statusSince: 200 })];
    expect(groupMembers(panes, other).map((p) => p.paneId)).toEqual(["b", "c", "a"]);
  });

  it("sinks panes with no known settle instant, keeping their incoming order", () => {
    const panes = [pane("a"), pane("b", { statusSince: 100 }), pane("c")];
    expect(groupMembers(panes, other).map((p) => p.paneId)).toEqual(["b", "a", "c"]);
  });

  it("leaves the other groups in the order the bridge sent", () => {
    const panes = [pane("a", { status: "working", statusSince: 100 }), pane("b", { status: "working", statusSince: 300 })];
    expect(groupMembers(panes, working).map((p) => p.paneId)).toEqual(["a", "b"]);
  });
});

describe("orchestrators", () => {
  const pane = (paneId: string, workspaceLabel: string, cwd: string, status: AgentStatus = "idle") =>
    ({ paneId, workspaceLabel, cwd, status }) as AgentView;

  it("is derived from the workspace label AND the cwd, like bridge findOrchestrator", () => {
    expect(isOrchestrator(pane("a", "orchestrator-app", "/code/app"))).toBe(true);
    expect(isOrchestrator(pane("b", "orchestrator-app", "/code/other"))).toBe(false); // the operator's own session
    expect(isOrchestrator(pane("c", "app", "/code/app"))).toBe(false);
  });

  it("leads its triage group, idle ones before a newer settled pane", () => {
    const idle = AGENT_GROUPS.find((g) => g.key === "other")!;
    const plain = { ...pane("p", "work", "/code/app"), statusSince: 9 };
    const orch = { ...pane("o", "orchestrator-app", "/code/app"), statusSince: 1 };
    expect(groupMembers([plain, orch], idle).map((a) => a.paneId)).toEqual(["o", "p"]);
    const needs = AGENT_GROUPS.find((g) => g.key === "needs")!;
    const b1 = pane("b1", "work", "/code/app", "blocked");
    const b2 = pane("b2", "orchestrator-app", "/code/app", "blocked");
    expect(groupMembers([b1, b2], needs).map((a) => a.paneId)).toEqual(["b2", "b1"]);
  });
});
