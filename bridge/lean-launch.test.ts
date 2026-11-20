import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leanArgs, leanConfig, readLeanSources } from "./lean-launch.ts";

const src = {
  mcpServers: { zendesk: { command: "z" }, crewdesign: { command: "c" }, "collie-board": { command: "old" } },
  enabledPlugins: { "stripe@official": true, "godot@skillsmith": true, "off@x": false },
};
const board = { command: "bun" };

describe("leanConfig", () => {
  test("a repo with no setting: the board's server only, every enabled plugin off", () => {
    expect(leanConfig(src, [], board)).toEqual({
      mcp: { mcpServers: { "collie-board": board } },
      settings: { enabledPlugins: { "stripe@official": false, "godot@skillsmith": false } },
    });
  });

  test("a kept name keeps that server or plugin, and the board's own server always wins", () => {
    const { mcp, settings } = leanConfig(src, ["crewdesign", "stripe", "collie-board"], board);
    expect(mcp).toEqual({ mcpServers: { "collie-board": board, crewdesign: { command: "c" } } });
    expect(settings).toEqual({ enabledPlugins: { "godot@skillsmith": false } });
  });

  test("nothing to turn off: no settings file", () => {
    expect(leanConfig({ mcpServers: {}, enabledPlugins: {} }, [], board).settings).toBeNull();
  });
});

describe("readLeanSources / leanArgs", () => {
  const home = mkdtempSync(join(tmpdir(), "lean-"));
  const repo = join(home, "repo");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { zendesk: { command: "z" } }, projects: { [repo]: { mcpServers: { crewdesign: { command: "c" } } } } }));
  writeFileSync(join(home, "settings.json"), JSON.stringify({ enabledPlugins: { "stripe@official": true } }));
  writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "l" } } }));

  test("reads user, project and .mcp.json servers, and the user's plugins", () => {
    const s = readLeanSources(repo, repo, home);
    expect(Object.keys(s.mcpServers).sort()).toEqual(["crewdesign", "local", "zendesk"]);
    expect(s.enabledPlugins).toEqual({ "stripe@official": true });
  });

  test("only claude gets flags; the files hold what the launch loads", () => {
    expect(leanArgs("opencode", { stateDir: home, port: 1 }, repo, [])).toEqual([]);
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const args = leanArgs("claude", { stateDir: home, port: 9999 }, repo, ["crewdesign"]);
      expect(args[0]).toBe("--strict-mcp-config");
      const mcp = JSON.parse(readFileSync(args[2]!, "utf8"));
      expect(Object.keys(mcp.mcpServers)).toEqual(["collie-board", "crewdesign"]);
      expect(mcp.mcpServers["collie-board"].env.COLLIE_BOARD_PORT).toBe("9999");
      expect(JSON.parse(readFileSync(args[4]!, "utf8"))).toEqual({ enabledPlugins: { "stripe@official": false } });
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });

  test("a spec naming frontend-design keeps that plugin; one that does not stays lean", () => {
    writeFileSync(join(home, "settings.json"), JSON.stringify({ enabledPlugins: { "stripe@official": true, "frontend-design@official": true } }));
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const off = (args: string[]) => JSON.parse(readFileSync(args[4]!, "utf8")).enabledPlugins;
      const ui = leanArgs("claude", { stateDir: home, port: 1 }, repo, [], repo, "Skill frontend-design en tête. Refaire la carte.");
      const plain = leanArgs("claude", { stateDir: home, port: 1 }, repo, [], repo, "Corriger le parseur.");
      expect(off(ui)).toEqual({ "stripe@official": false });
      expect(off(plain)).toEqual({ "stripe@official": false, "frontend-design@official": false });
      expect(ui[4]).not.toBe(plain[4]);
    } finally {
      writeFileSync(join(home, "settings.json"), JSON.stringify({ enabledPlugins: { "stripe@official": true } }));
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });
});
