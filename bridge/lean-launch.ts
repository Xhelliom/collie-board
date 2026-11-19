// A board agent (a card's worker, the lead, the copilot) starts with the collie-board MCP and none
// of the operator's other MCP servers or plugins — each was re-read on every call (docs/dev/couts-2026-11.md,
// frein 2). A repo keeps named ones in its settings (`repo_pref.kept_mcp`). Claude only: the other
// harnesses have no such flags. The orchestrator and manual sessions never come through here.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Json = Record<string, unknown>;

export interface LeanSources {
  /** Every MCP server Claude would have loaded there, by name: user, project, `.mcp.json`. */
  mcpServers: Record<string, unknown>;
  /** `enabledPlugins` merged across the user's and the checkout's settings. */
  enabledPlugins: Record<string, boolean>;
}

/** The plugin's own name: `stripe@claude-plugins-official` → `stripe`. */
const pluginName = (id: string) => id.split("@")[0]!;

/** Pure: what the launch loads. `keep` names MCP servers or plugins; the board's own server is always there. */
export function leanConfig(src: LeanSources, keep: readonly string[], boardServer: unknown): { mcp: Json; settings: Json | null } {
  const kept = new Set(keep);
  const mcpServers: Json = { "collie-board": boardServer };
  for (const [name, def] of Object.entries(src.mcpServers)) if (kept.has(name) && name !== "collie-board") mcpServers[name] = def;
  const off: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(src.enabledPlugins)) if (on && !kept.has(pluginName(id)) && !kept.has(id)) off[id] = false;
  return { mcp: { mcpServers }, settings: Object.keys(off).length ? { enabledPlugins: off } : null };
}

function readJson(file: string): Json {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  } catch {
    return {};
  }
}

const servers = (o: unknown) => ((o as Json | undefined)?.mcpServers as Json | undefined) ?? {};
const plugins = (o: Json) => (o.enabledPlugins as Record<string, boolean> | undefined) ?? {};

/** What Claude Code would load in `checkout` of `repoPath`, read off its own files. Never throws. */
export function readLeanSources(repoPath: string, checkout: string = repoPath, configDir = process.env.CLAUDE_CONFIG_DIR): LeanSources {
  const claudeJson = readJson(join(configDir || homedir(), ".claude.json"));
  const projects = (claudeJson.projects as Json | undefined) ?? {};
  return {
    mcpServers: { ...servers(claudeJson), ...servers(projects[repoPath]), ...servers(projects[checkout]), ...servers(readJson(join(repoPath, ".mcp.json"))), ...servers(readJson(join(checkout, ".mcp.json"))) },
    enabledPlugins: {
      ...plugins(readJson(join(configDir || join(homedir(), ".claude"), "settings.json"))),
      ...plugins(readJson(join(checkout, ".claude", "settings.json"))),
      ...plugins(readJson(join(checkout, ".claude", "settings.local.json"))),
    },
  };
}

/** The names a repo may keep: its MCP servers and plugins, the board's own left out. */
export function keepableNames(repoPath: string): { mcp: string[]; plugins: string[] } {
  const src = readLeanSources(repoPath);
  return {
    mcp: Object.keys(src.mcpServers).filter((n) => n !== "collie-board").sort(),
    plugins: [...new Set(Object.entries(src.enabledPlugins).filter(([, on]) => on).map(([id]) => pluginName(id)))].sort(),
  };
}

/**
 * The extra CLI arguments of a board agent's launch. Written to files under `stateDir`, not inlined:
 * hc TYPES the command into the pane's shell. Never fails the launch — on error the agent starts as before.
 */
export function leanArgs(kind: string, cfg: { stateDir: string; port: number }, repoPath: string | null | undefined, keep: readonly string[], checkout?: string | null): string[] {
  if (kind !== "claude") return [];
  try {
    const board = { type: "stdio", command: process.execPath, args: ["run", join(import.meta.dir, "mcp.ts")], env: { COLLIE_BOARD_PORT: String(cfg.port) } };
    const where = repoPath ?? checkout ?? homedir();
    const { mcp, settings } = leanConfig(readLeanSources(where, checkout ?? where), keep, board);
    const dir = join(cfg.stateDir, "lean-launch");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = createHash("sha1").update(where).digest("hex").slice(0, 12);
    const mcpFile = join(dir, `${key}.mcp.json`);
    writeFileSync(mcpFile, JSON.stringify(mcp, null, 2), { mode: 0o600 });
    const args = ["--strict-mcp-config", "--mcp-config", mcpFile];
    if (settings) {
      const settingsFile = join(dir, `${key}.settings.json`);
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
      args.push("--settings", settingsFile);
    }
    return args;
  } catch (err) {
    console.warn(`[lean-launch] ${repoPath ?? "(no repo)"}: ${(err as Error).message}`);
    return [];
  }
}
