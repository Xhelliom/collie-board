import { describe, expect, it } from "vitest";

import { ago, agentsPage, DEFAULT_FILTERS, nameOf } from "./agents-page";
import type { AgentView } from "./types";

const pane = (p: Partial<AgentView> & { paneId: string }): AgentView => ({
  workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "idle", cwd: "/r/alpha", focused: false, ...p,
});

const herd = [
  pane({ paneId: "a", status: "working", cardTitle: "Fix login", cwd: "/home/u/.herdr/worktrees/alpha/board/x" }),
  pane({ paneId: "orch", status: "idle", workspaceLabel: "orchestrator-alpha", cwd: "/r/alpha" }),
  pane({ paneId: "b", status: "blocked", cwd: "/r/beta", peer: "dev" }),
  pane({ paneId: "sh", kind: "shell", agent: "shell", status: "unknown", cwd: "/r/beta" }),
  pane({ paneId: "lead", status: "working", cwd: "/r/board" }),
  pane({ paneId: "c", status: "done", cwd: "/r/gamma", statusSince: 1 }),
];
const run = (f = {}, q = "") => agentsPage(herd, { ...DEFAULT_FILTERS, ...f }, q, new Set(["lead"]), "Orchestrator");
const ids = (p: ReturnType<typeof run>) => [...p.live, ...p.resting].map((g) => `${g.project}:${g.agents.map((a) => a.paneId).join(",")}`);

describe("agentsPage", () => {
  it("groups by project, live first (waiting before working), board panes and shells left out", () => {
    const p = run();
    expect(ids(p)).toEqual(["beta:b", "alpha:a,orch", "gamma:c"]);
    expect(p.counts).toEqual({ needs: 1, working: 1, idle: 2 });
    expect(p.machines).toEqual(["dev"]);
  });

  it("shows shells on demand, hides orchestrators unless one waits", () => {
    expect(ids(run({ terminals: true }))).toContain("beta:b,sh");
    expect(ids(run({ hideOrch: true }))).toContain("alpha:a");
    const waiting = agentsPage([pane({ paneId: "o", status: "blocked", workspaceLabel: "orchestrator-alpha", cwd: "/r/alpha" })], { ...DEFAULT_FILTERS, hideOrch: true }, "", new Set(), "O");
    expect(waiting.live).toHaveLength(1);
  });

  it("filters by state, machine and search (card title, project, name)", () => {
    expect(ids(run({ state: "working" }))).toEqual(["alpha:a"]);
    expect(ids(run({ machine: "dev" }))).toEqual(["beta:b"]);
    expect(ids(run({ machine: "" }))).not.toContain("beta:b");
    expect(ids(run({}, "login"))).toEqual(["alpha:a"]);
    expect(ids(run({}, "GAMMA"))).toEqual(["gamma:c"]);
    expect(ids(run({}, "orchestrator"))).toEqual(["alpha:orch"]);
  });

  it("names a row by its card, else Orchestrator, else the pane", () => {
    expect(nameOf(herd[0]!, "O")).toBe("Fix login");
    expect(nameOf(herd[1]!, "O")).toBe("O");
    expect(nameOf(herd[2]!, "O")).toBe("claude");
  });

  it("ago is coarse", () => {
    const u = { min: "min", h: "h", d: "j" };
    expect(ago(12 * 60_000, u)).toBe("12 min");
    expect(ago(2 * 3_600_000 + 5 * 60_000, u)).toBe("2 h");
    expect(ago(72 * 3_600_000, u)).toBe("3 j");
  });
});
