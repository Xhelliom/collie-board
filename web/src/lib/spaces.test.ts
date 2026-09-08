import { blockedCount, groupPanesBySpace, groupPanesByTab, worstSpaceStatus } from "./spaces";
import type { AgentStatus, AgentView, TabView, WorkspaceView } from "./types";

function agent(
  partial: Partial<AgentView> & { paneId: string; workspaceId: string; tabId: string },
): AgentView {
  return {
    workspaceLabel: "ws",
    workspaceNumber: 1,
    agent: "claude",
    status: "idle",
    cwd: "/home/you/demo",
    focused: false,
    ...partial,
  };
}

const tab = (tabId: string, workspaceId: string, number: number): TabView => ({
  tabId,
  workspaceId,
  number,
  label: String(number),
  focused: false,
  paneCount: 1,
});

describe("groupPanesByTab", () => {
  const tabs = [tab("w1:t2", "w1", 2), tab("w1:t1", "w1", 1)]; // differs from stable number order

  it("preserves snapshot tab order when grouping panes", () => {
    const a1 = agent({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1" });
    const a2 = agent({ paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t2" });
    const groups = groupPanesByTab("w1", tabs, [a1, a2], []);
    expect(groups.map((g) => g.tabId)).toEqual(["w1:t2", "w1:t1"]);
    expect(groups[0]!.panes).toEqual([a2]);
    expect(groups[1]!.panes).toEqual([a1]);
  });

  it("includes shell panes alongside agents in their tab", () => {
    const a1 = agent({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1" });
    const shell = agent({ paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t1", kind: "shell" });
    const group = groupPanesByTab("w1", tabs, [a1], [shell]).find((item) => item.tabId === "w1:t1");
    expect(group!.panes).toEqual([a1, shell]);
  });

  it("collects panes whose tab isn't listed yet into a trailing '…' group", () => {
    const orphan = agent({ paneId: "w1:p9", workspaceId: "w1", tabId: "w1:tX" });
    const groups = groupPanesByTab("w1", tabs, [orphan], []);
    const last = groups.at(-1)!;
    expect(last.tabId).toBe("w1:other");
    expect(last.label).toBe("…");
    expect(last.panes).toEqual([orphan]);
  });

  it("ignores panes from other workspaces", () => {
    const other = agent({ paneId: "w2:p1", workspaceId: "w2", tabId: "w2:t1" });
    const groups = groupPanesByTab("w1", tabs, [other], []);
    expect(groups.every((g) => g.panes.length === 0)).toBe(true);
  });
});

describe("blockedCount", () => {
  it("counts only blocked agents within the given workspace", () => {
    const agents = [
      agent({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", status: "blocked" }),
      agent({ paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t1", status: "working" }),
      agent({ paneId: "w2:p1", workspaceId: "w2", tabId: "w2:t1", status: "blocked" }),
    ];
    expect(blockedCount("w1", agents)).toBe(1);
    expect(blockedCount("w2", agents)).toBe(1);
    expect(blockedCount("w3", agents)).toBe(0);
  });

  it("counts every blocked agent, not just presence", () => {
    const agents = [
      agent({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", status: "blocked" }),
      agent({ paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t1", status: "blocked" }),
      agent({ paneId: "w1:p3", workspaceId: "w1", tabId: "w1:t1", status: "working" }),
    ];
    expect(blockedCount("w1", agents)).toBe(2);
  });
});

describe("worstSpaceStatus", () => {
  const mk = (status: AgentStatus) =>
    agent({ paneId: `w1:${status}`, workspaceId: "w1", tabId: "w1:t1", status });

  it("returns null when the workspace has no agents", () => {
    expect(worstSpaceStatus("w1", [])).toBeNull();
    expect(worstSpaceStatus("w1", [agent({ paneId: "w2:p1", workspaceId: "w2", tabId: "w2:t1" })])).toBeNull();
  });

  it("returns the most-urgent status (blocked beats working beats idle/done)", () => {
    expect(worstSpaceStatus("w1", [mk("idle"), mk("working"), mk("blocked")])).toBe("blocked");
    expect(worstSpaceStatus("w1", [mk("done"), mk("working")])).toBe("working");
    expect(worstSpaceStatus("w1", [mk("idle"), mk("done")])).toBe("idle");
  });

  it("ranks unknown between working and idle", () => {
    expect(worstSpaceStatus("w1", [mk("idle"), mk("unknown")])).toBe("unknown");
    expect(worstSpaceStatus("w1", [mk("working"), mk("unknown")])).toBe("working");
  });
});

describe("groupPanesBySpace", () => {
  const blocked = agent({ paneId: "w2:p1", workspaceId: "w2", tabId: "w2:t1", workspaceNumber: 2, workspaceLabel: "two", status: "blocked" });
  const idle = agent({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", workspaceLabel: "one" });
  const shell = agent({ paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t1", workspaceLabel: "one", kind: "shell", status: "unknown" });

  it("collects a space's agents and shells into one group", () => {
    const [one] = groupPanesBySpace([idle], [shell]);
    expect(one?.workspaceId).toBe("w1");
    expect(one?.label).toBe("one");
    expect(one?.panes.map((p) => p.paneId)).toEqual(["w1:p1", "w1:p2"]);
  });

  it("sorts the space needing you first, whatever order the snapshot sent", () => {
    const groups = groupPanesBySpace([idle, blocked], []);
    expect(groups.map((g) => g.workspaceId)).toEqual(["w2", "w1"]);
    expect(groups[0]?.blocked).toBe(1);
    expect(groups[1]?.blocked).toBe(0);
  });

  it("ranks a space on its worst agent, and a shell-only space last", () => {
    const shellOnly = groupPanesBySpace([blocked], [shell]);
    expect(shellOnly.map((g) => g.workspaceId)).toEqual(["w2", "w1"]);
    expect(shellOnly[1]?.status).toBeNull(); // only a shell in it — no agent status to show
  });

  it("takes the space's branch from whichever pane in it backs a card", () => {
    const carded = { ...shell, branch: undefined };
    const group = groupPanesBySpace([{ ...idle, branch: "board/x" }], [carded])[0];
    expect(group?.branch).toBe("board/x");
  });

  it("reports no branch rather than guessing one when no pane carries it", () => {
    expect(groupPanesBySpace([idle], [])[0]?.branch).toBeNull();
  });

  it("keeps the space's cwd for the header's fallback line", () => {
    expect(groupPanesBySpace([idle], [])[0]?.cwd).toBe("/home/you/demo");
  });

  // A card's worktree is a first-class space to herdr — nothing in the snapshot ties it back to the
  // repo it was cut from except the directory herdr parked it in.
  const repo = agent({ paneId: "wR:p1", workspaceId: "wR", tabId: "wR:t1", workspaceNumber: 1, workspaceLabel: "collie", cwd: "/home/you/git/collie" });
  const tree = agent({ paneId: "wT:p1", workspaceId: "wT", tabId: "wT:t1", workspaceNumber: 9, workspaceLabel: "Refondre la page", cwd: "/home/you/.herdr/worktrees/collie/board-refonte", branch: "board/refonte" });

  it("hangs a worktree space under the repo space it was cut from", () => {
    const groups = groupPanesBySpace([repo, tree], []);
    expect(groups.map((g) => g.workspaceId)).toEqual(["wR"]);
    expect(groups[0]?.children.map((c) => c.workspaceId)).toEqual(["wT"]);
    // The child stays a space in its own right — its own branch, its own panes, its own counters.
    expect(groups[0]?.children[0]?.branch).toBe("board/refonte");
    expect(groups[0]?.panes.map((p) => p.paneId)).toEqual(["wR:p1"]);
  });

  it("leaves a worktree at the top level rather than invent a parent", () => {
    expect(groupPanesBySpace([tree], []).map((g) => g.workspaceId)).toEqual(["wT"]);
  });

  it("does not mistake a plain directory that merely shares a repo's name for a worktree", () => {
    const sibling = agent({ paneId: "wS:p1", workspaceId: "wS", tabId: "wS:t1", workspaceNumber: 2, cwd: "/home/you/backups/collie/2026" });
    expect(groupPanesBySpace([repo, sibling], []).map((g) => g.workspaceId)).toEqual(["wR", "wS"]);
  });

  it("pulls a repo to the top when it is a WORKTREE of it that needs you", () => {
    const other = agent({ paneId: "wO:p1", workspaceId: "wO", tabId: "wO:t1", workspaceNumber: 0, workspaceLabel: "other", status: "working" });
    const groups = groupPanesBySpace([{ ...repo, status: "done" }, { ...tree, status: "blocked" }, other], []);
    // "collie" is done and would sort last on its own panes; the blocked worktree inside it wins.
    expect(groups.map((g) => g.workspaceId)).toEqual(["wR", "wO"]);
    // …and the count stays where it is true: the parent speaks for its own panes, the child for its.
    expect(groups[0]?.blocked).toBe(0);
    expect(groups[0]?.children[0]?.blocked).toBe(1);
  });

  it("lists a space that has no pane in the snapshot when the space list is passed", () => {
    const empty: WorkspaceView = { workspaceId: "wE", number: 7, label: "fresh", focused: false, activeTabId: "wE:t1", tabCount: 1, paneCount: 0 };
    expect(groupPanesBySpace([], [], [empty]).map((g) => g.label)).toEqual(["fresh"]);
    // …and not when it isn't: the pane switcher lists what you can switch to.
    expect(groupPanesBySpace([], [])).toEqual([]);
  });
});
