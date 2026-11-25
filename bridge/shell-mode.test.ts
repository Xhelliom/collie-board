import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BUILTIN_ADAPTERS, loadAdapters } from "./adapters.ts";
import { shellSplit } from "./shell-mode.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const snap = (agent: string, status = "idle", bridge = "connected") =>
  ({ agents: [{ paneId: "p1", agent, status }], shellPanes: [], workspaces: [], tabs: [], bridge }) as unknown as EngineSnapshot;

describe("shellSplit — `!` typed first for an agent with a shell mode", () => {
  const shipped = loadAdapters([join(import.meta.dir, "..", "adapters", "agents.toml")]);

  test("claude: `!pwd` → type `!`, then send `pwd`", () => {
    expect(shipped.claude!.shellPrefix).toBe("!");
    expect(shellSplit(snap("claude"), shipped, "p1", "!pwd")).toEqual({ prefix: "!", rest: "pwd" });
  });

  test("a normal message, a bare `!`, another agent: as before", () => {
    expect(shellSplit(snap("claude"), shipped, "p1", "fix the test")).toBeNull();
    expect(shellSplit(snap("claude"), shipped, "p1", "! ")).toBeNull();
    expect(shellSplit(snap("codex"), shipped, "p1", "!pwd")).toBeNull();
    expect(shellSplit(snap("claude"), shipped, "p2", "!pwd")).toBeNull();
  });

  test("a blocked agent or a disconnected snapshot: never a typed key", () => {
    expect(shellSplit(snap("claude", "blocked"), BUILTIN_ADAPTERS, "p1", "!pwd")).toBeNull();
    expect(shellSplit(snap("claude", "idle", "disconnected"), BUILTIN_ADAPTERS, "p1", "!pwd")).toBeNull();
  });
});
