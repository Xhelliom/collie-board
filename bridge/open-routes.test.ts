import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";

const repo = mkdtempSync(join(tmpdir(), "open-"));
mkdirSync(join(repo, ".git"));
// trustFolder writes there, not in the developer's own ~/.claude.json.
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "open-claude-"));

function setup() {
  const calls: string[] = [];
  const herdr = {
    createWorkspace: async (o: { cwd: string; label?: string; show?: { tab: string; title: string } }) => (
      calls.push(`workspace ${o.label} ${o.cwd} [${o.show?.title}]`), { paneId: "t1", workspaceId: "hc", tabId: "hc", cwd: o.cwd }
    ),
    startAgent: async (o: { kind: string; args?: string[] }) => void calls.push(`start ${o.kind} ${(o.args ?? []).join(" ")}`.trim()),
    getAgent: async () => ({ interactive_ready: true, agent_status: "working" }),
    promptAgent: async (o: { text: string }) => (calls.push(`prompt ${o.text}`), true),
  };
  const db = new BoardDb(":memory:");
  const ctx = {
    db,
    herdr,
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: {},
    cfg: { boardAgentKind: "claude" },
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  } as never;
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await handleBoardRoute("/api/project/open", new Request("http://x/api/project/open", { method: "POST", headers, body: JSON.stringify(body) }), ctx);
    return { status: res!.status, body: (await res!.json().catch(() => null)) as { ok?: boolean; pane?: { paneId: string; cwd: string } } | null };
  };
  return { calls, db, post };
}

describe("POST /api/project/open", () => {
  it("a terminal: one shell in the repo's folder, labelled and filed for herdr-app, no agent started", async () => {
    const { calls, post } = setup();
    const r = await post({ repoPath: repo, open: "terminal" });
    expect(r.status).toBe(200);
    expect(r.body?.pane).toMatchObject({ paneId: "t1", cwd: repo });
    expect(calls).toEqual([`workspace free-${basename(repo)} ${repo} [${basename(repo)} · terminal]`]);
  });

  it("an agent: the board's default kind through launchAgent; a template gives its kind, model flag and brief", async () => {
    const { calls, db, post } = setup();
    expect((await post({ repoPath: repo, open: "agent" })).body?.ok).toBe(true);
    expect(calls.slice(1)).toEqual(["start claude"]);

    calls.length = 0;
    const tpl = db.createTemplate({ name: "Relecteur", agentKind: "claude", model: "opus", brief: "Relis." });
    expect((await post({ repoPath: repo, open: "agent", templateId: tpl.id })).status).toBe(200);
    expect(calls.slice(1)).toEqual(["start claude --model opus", "prompt Relis."]);

    calls.length = 0;
    expect((await post({ repoPath: repo, open: "agent", agentKind: "codex" })).status).toBe(200);
    expect(calls[0]).toContain("· codex]");
    expect(calls[1]).toBe("start codex");
  });

  it("refuses an agent pane, a path that is no repo root, and a body it cannot read", async () => {
    const { calls, post } = setup();
    expect((await post({ repoPath: repo, open: "agent" }, { "x-collie-pane": "t7" })).status).toBe(403);
    expect((await post({ repoPath: tmpdir(), open: "agent" })).status).toBe(400);
    expect((await post({ repoPath: repo })).status).toBe(400);
    expect((await post({ repoPath: repo, open: "agent", agentKind: "rm -rf" })).status).toBe(400);
    expect((await post({ repoPath: repo, open: "agent", templateId: "nope" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
