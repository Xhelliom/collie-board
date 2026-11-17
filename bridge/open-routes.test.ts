import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { CompositeMux } from "./mux/composite.ts";

const repo = mkdtempSync(join(tmpdir(), "open-"));
mkdirSync(join(repo, ".git"));
// trustFolder writes there, not in the developer's own ~/.claude.json.
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "open-claude-"));

type Show = { tab: string; title: string; space?: string };

function setup(wrap?: (fake: object) => object) {
  const calls: string[] = [];
  const fake = {
    createWorkspace: async (o: { cwd: string; label?: string; show?: Show }) => (
      calls.push(`workspace ${o.label} ${o.cwd} [${o.show?.title}]${o.show?.space ? ` in ${o.show.space}` : ""}`), { paneId: "t1", workspaceId: "hc", tabId: "hc", cwd: o.cwd }
    ),
    startAgent: async (o: { kind: string; args?: string[] }) => void calls.push(`start ${o.kind} ${(o.args ?? []).join(" ")}`.trim()),
    getAgent: async () => ({ interactive_ready: true, agent_status: "working" }),
    promptAgent: async (o: { text: string }) => (calls.push(`prompt ${o.text}`), true),
  };
  const herdr = wrap ? wrap(fake) : fake;
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
    return { status: res!.status, body: (await res!.json().catch(() => null)) as Opened | null };
  };
  return { calls, db, post };
}

type Opened = { ok?: boolean; pane?: { paneId: string; cwd: string }; engine?: string; fallback?: boolean; place?: { space: string; tab: string | null } };

describe("POST /api/project/open", () => {
  it("a terminal: one shell in the repo's folder, labelled and filed for herdr-app, no agent started", async () => {
    const { calls, post } = setup();
    const r = await post({ repoPath: repo, open: "terminal" });
    expect(r.status).toBe(200);
    expect(r.body?.pane).toMatchObject({ paneId: "t1", cwd: repo });
    expect(calls).toEqual([`workspace free-${basename(repo)} ${repo} [${basename(repo)} · terminal]`]);
  });

  it("says where it opened: hc's « Collie Board » by default, or the space the operator typed", async () => {
    const { calls, post } = setup();
    const r = await post({ repoPath: repo, open: "terminal" });
    expect(r.body).toMatchObject({ engine: "hc", fallback: false, place: { space: "Collie Board", tab: `${basename(repo)} · terminal` } });
    const typed = await post({ repoPath: repo, open: "terminal", space: " Revue " });
    expect(typed.body?.place?.space).toBe("Revue");
    expect(calls[1]).toEndWith(" in Revue");
  });

  it("a fallback: auto wanted hc, hc did not answer — herdr 0.9's workspace, flagged", async () => {
    const hc = { ping: async () => false };
    const { post } = setup((fake) => new CompositeMux({
      hc: hc as never,
      herdr09: { ...fake, createWorkspace: async (o: { cwd: string }) => ({ paneId: "w3:p1", workspaceId: "w3", workspaceLabel: "free-app", tabId: "w3:t1", cwd: o.cwd }) } as never,
    }, "auto"));
    const r = await post({ repoPath: repo, open: "terminal", space: "Revue" });
    expect(r.body).toMatchObject({ engine: "herdr09", fallback: true, place: { space: "free-app", tab: null } });
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
    expect((await post({ repoPath: repo, open: "terminal", space: "---" })).status).toBe(400);
    expect((await post({ repoPath: repo, open: "terminal", space: "x".repeat(41) })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
