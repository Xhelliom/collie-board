import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { startCard } from "./cards.ts";
import { handleBoardRoute } from "./board-routes.ts";
import type { Config } from "./config.ts";
import { BoardDb, type AgentTemplate } from "./db.ts";
import {
  BUILTIN_TEMPLATES,
  composePrompt,
  draftPrompt,
  isModel,
  modelArgs,
  parseAgentFile,
  resolveTemplate,
  toTemplateDraft,
} from "./templates.ts";

const tpl = (o: Partial<AgentTemplate> & { id: string }): AgentTemplate => ({
  key: null,
  name: o.id,
  description: "",
  agentKind: null,
  model: null,
  brief: "BRIEF",
  builtin: false,
  createdAt: 0,
  updatedAt: 0,
  ...o,
});

describe("pure helpers", () => {
  it("composePrompt puts the brief, a separator, then the card's prompt — or just the prompt", () => {
    expect(composePrompt("ROLE", "TASK")).toBe("ROLE\n\n---\n\nTASK");
    expect(composePrompt("  ", "TASK")).toBe("TASK");
  });

  it("modelArgs speaks only for a kind with a verified flag, and never passes a flag-looking model", () => {
    expect(modelArgs("claude", "sonnet")).toEqual(["--model", "sonnet"]);
    expect(modelArgs("codex", "sonnet")).toEqual([]);
    expect(modelArgs("claude", null)).toEqual([]);
    expect(modelArgs("claude", "--dangerously-skip-permissions")).toEqual([]);
    expect(modelArgs("claude", "a b")).toEqual([]);
    expect(modelArgs("mystery", "sonnet")).toEqual([]);
    expect(isModel("claude-sonnet-4-5")).toBe(true);
    expect(isModel("-x")).toBe(false);
  });

  it("resolveTemplate: the card's own, else its phase's, else none", () => {
    const all = [tpl({ id: "a" }), tpl({ id: "b" })];
    expect(resolveTemplate({ templateId: "a" }, { templateId: "b" }, all)?.id).toBe("a");
    expect(resolveTemplate({ templateId: null }, { templateId: "b" }, all)?.id).toBe("b");
    expect(resolveTemplate({ templateId: null }, null, all)).toBeNull();
    expect(resolveTemplate({ templateId: "gone" }, { templateId: "b" }, all)).toBeNull();
  });

  it("parseAgentFile reads Claude Code's agent file, and refuses what is not one", () => {
    const f = parseAgentFile('---\nname: ovg-reviewer\ndescription: "Read-only reviewer"\ntools: Read, Grep\nmodel: opus\n---\n\nYou review.\n');
    expect(f).toEqual({ name: "ovg-reviewer", description: "Read-only reviewer", model: "opus", tools: "Read, Grep", brief: "You review." });
    expect(parseAgentFile("---\nname: x\nmodel: inherit\n---\nbody")!.model).toBeNull();
    expect(parseAgentFile("no frontmatter")).toBeNull();
    expect(parseAgentFile("---\ndescription: no name\n---\nbody")).toBeNull();
    expect(parseAgentFile("---\nname: x\n---\n   ")).toBeNull();
    expect(parseAgentFile(`---\nname: x\n---\n${"a".repeat(70_000)}`)).toBeNull();
  });

  it("toTemplateDraft throws on a half answer and drops a bad model or kind", () => {
    expect(toTemplateDraft({ name: " Sec ", description: "d", agentKind: "claude", model: "opus", brief: "Do x." })).toEqual({
      name: "Sec",
      description: "d",
      agentKind: "claude",
      model: "opus",
      brief: "Do x.",
    });
    expect(toTemplateDraft({ name: "n", brief: "b", model: "--x", agentKind: "Bad Kind" })).toMatchObject({ model: null, agentKind: null });
    expect(() => toTemplateDraft({ name: "n" })).toThrow();
    expect(() => toTemplateDraft("x")).toThrow();
    expect(draftPrompt({ description: "a security reviewer", baseOn: null, outPath: "/o.json" })).toContain("/o.json");
  });
});

describe("the shipped templates in the db", () => {
  it("seeds the five once, and never touches one the operator edited", () => {
    const file = join(mkdtempSync(join(tmpdir(), "collie-tpl-")), "board.db");
    let db = new BoardDb(file);
    expect(db.listTemplates().map((t) => t.key).sort()).toEqual(["doc", "explore", "fix", "implementer", "reviewer"]);
    const impl = db.listTemplates().find((t) => t.key === "implementer")!;
    db.updateTemplate(impl.id, { brief: "my own brief" });
    db.close();
    db = new BoardDb(file); // reopening seeds again: only what is missing
    expect(db.listTemplates()).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(db.getTemplate(impl.id)!.brief).toBe("my own brief");
    // …and a reset puts it back as shipped.
    expect(db.resetTemplate(impl.id)!.brief).toBe(BUILTIN_TEMPLATES.find((b) => b.key === "implementer")!.brief);
    db.close();
  });

  it("a shipped template is reset, never deleted; a custom one can go, and leaves no dangling reference", () => {
    const db = new BoardDb(":memory:");
    const shipped = db.listTemplates()[0]!;
    expect(db.deleteTemplate(shipped.id)).toBe("builtin");
    const mine = db.createTemplate({ name: "Mine", brief: "b" });
    expect(db.resetTemplate(mine.id)).toBeNull();
    const card = db.createCard({ title: "c", repoPath: "/r", templateId: mine.id });
    const phase = db.createPhase({ repoPath: "/r", name: "P", templateId: mine.id });
    expect(db.getCard(card.id)!.templateId).toBe(mine.id);
    expect(db.deleteTemplate(mine.id)).toBe("deleted");
    expect(db.getCard(card.id)!.templateId).toBeNull();
    expect(db.getPhase(phase.id)!.templateId).toBeNull();
    expect(db.deleteTemplate(mine.id)).toBe("missing");
    db.close();
  });

  it("migrates a board from before templates without losing a card", () => {
    const file = join(mkdtempSync(join(tmpdir(), "collie-tpl-old-")), "board.db");
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE card (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, repo_path TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.exec(`CREATE TABLE phase (id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.exec(`INSERT INTO card VALUES ('c1','old','ready','/r',0,1,1)`);
    old.close();
    const db = new BoardDb(file);
    expect(db.getCard("c1")).toMatchObject({ title: "old", templateId: null });
    expect(db.listTemplates().length).toBe(BUILTIN_TEMPLATES.length);
    db.close();
  });
});

// ── starting a card with a template ─────────────────────────────────────────────

function fakeHerdr() {
  const started: { kind: string; args?: string[] }[] = [];
  const prompts: string[] = [];
  const client = {
    async createWorktree(o: { branch: string }) {
      return { checkoutPath: `/wt/${o.branch}`, branch: o.branch, workspaceId: "wZ", workspaceLabel: o.branch, tabId: "wZ:t1", paneId: "wZ:p1", alreadyOpen: false };
    },
    async openWorktree() {
      throw new Error("unused");
    },
    async sendPaneKeys() {},
    async getPane() {
      return {};
    },
    async getAgent() {
      return { interactive_ready: true, agent_status: "working" };
    },
    async startAgent(o: { kind: string; args?: string[] }) {
      started.push({ kind: o.kind, args: o.args });
    },
    async promptAgent(o: { text: string }) {
      prompts.push(o.text);
    },
  };
  return { client, started, prompts };
}
const cfg = { boardAgentKind: "claude", boardMaxAgents: 5, boardBranchPrefix: "board/" } as Config;

describe("startCard with a template (ADR 0026)", () => {
  it("passes the model flag and puts the brief in front of the first prompt", async () => {
    const db = new BoardDb(":memory:");
    const t = db.createTemplate({ name: "Rev", brief: "ROLE BRIEF", model: "opus" });
    const card = db.createCard({ title: "ship it", spec: "do it", repoPath: "/repo", baseRef: "main", status: "ready", templateId: t.id });
    const { client, started, prompts } = fakeHerdr();
    const res = await startCard(db, client as never, cfg, card.id, { sleep: async () => {} });
    expect(res.ok).toBe(true);
    expect(started).toEqual([{ kind: "claude", args: ["--model", "opus"] }]);
    expect(prompts[0]!.startsWith("ROLE BRIEF\n\n---\n\n")).toBe(true);
    expect(prompts[0]).toContain("do it");
    expect(db.listEvents(card.id).find((e) => e.type === "card.template")!.payload).toMatchObject({ name: "Rev", kind: "claude", args: ["--model", "opus"], model: "opus" });
    db.close();
  });

  it("the phase's template applies when the card has none; the card's own kind wins over the template's", async () => {
    const db = new BoardDb(":memory:");
    const t = db.createTemplate({ name: "Cx", brief: "B", agentKind: "codex", model: "opus" });
    const phase = db.createPhase({ repoPath: "/repo", name: "P", templateId: t.id });
    const a = db.createCard({ title: "a", repoPath: "/repo", baseRef: "main", status: "ready", phaseId: phase.id });
    const first = fakeHerdr();
    await startCard(db, first.client as never, cfg, a.id, { sleep: async () => {} });
    // the template's kind (codex) has no verified model flag: the model is ignored, not smuggled in
    expect(first.started).toEqual([{ kind: "codex", args: undefined }]);

    const b = db.createCard({ title: "b", repoPath: "/repo", baseRef: "main", status: "ready", phaseId: phase.id, agentKind: "claude" });
    const second = fakeHerdr();
    await startCard(db, second.client as never, cfg, b.id, { sleep: async () => {} });
    expect(second.started).toEqual([{ kind: "claude", args: ["--model", "opus"] }]);
    db.close();
  });

  it("a card with no template starts exactly as before: no args, the plain prompt", async () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "plain", spec: "s", repoPath: "/repo", baseRef: "main", status: "ready" });
    const { client, started, prompts } = fakeHerdr();
    await startCard(db, client as never, cfg, card.id, { sleep: async () => {} });
    expect(started).toEqual([{ kind: "claude", args: undefined }]);
    expect(prompts[0]).not.toContain("---");
    expect(db.listEvents(card.id).some((e) => e.type === "card.template")).toBe(false);
    db.close();
  });

  it("a special prompt (a conflict to settle) is sent as it is, without the brief", async () => {
    const db = new BoardDb(":memory:");
    const t = db.createTemplate({ name: "R", brief: "ROLE" });
    const card = db.createCard({ title: "x", repoPath: "/repo", baseRef: "main", status: "ready", templateId: t.id });
    const { client, prompts } = fakeHerdr();
    await startCard(db, client as never, cfg, card.id, { sleep: async () => {}, promptText: "fix the conflict" });
    expect(prompts).toEqual(["fix the conflict"]);
    db.close();
  });
});

// ── the routes ──────────────────────────────────────────────────────────────────

const ctx = (db: BoardDb, over: Record<string, unknown> = {}) =>
  ({
    db,
    herdr: {},
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: { busy: () => new Set<string>(), reformulate: () => {}, ask: async () => null },
    cfg: { boardCopilot: true },
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
    ...over,
  }) as never;

const call = async (db: BoardDb, method: string, path: string, body?: unknown, over: Record<string, unknown> = {}) => {
  const res = await handleBoardRoute(
    path.split("?")[0]!,
    new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    ctx(db, over),
  );
  const text = await res!.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text
  }
  // biome-ignore lint: test helper, the shape is asserted by each test
  return { status: res!.status, body: parsed as any };
};

describe("/api/templates", () => {
  it("lists with the kinds that take a model, creates, edits, and refuses a flag as a model", async () => {
    const db = new BoardDb(":memory:");
    const list = await call(db, "GET", "/api/templates");
    expect(list.body.templates).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(list.body.modelKinds).toEqual(["claude"]);

    const made = await call(db, "POST", "/api/templates", { name: "Sec", brief: "Look at auth.", model: "opus", agentKind: "claude" });
    expect(made.status).toBe(201);
    expect((await call(db, "POST", "/api/templates", { name: "Bad", brief: "b", model: "--yolo" })).status).toBe(400);
    expect((await call(db, "POST", "/api/templates", { name: "", brief: "b" })).status).toBe(400);
    const id = made.body.template.id;
    expect((await call(db, "PATCH", `/api/templates/${id}`, { brief: "New." })).body.template.brief).toBe("New.");
    expect((await call(db, "PATCH", `/api/templates/${id}`, { model: "-x" })).status).toBe(400);
    expect((await call(db, "DELETE", `/api/templates/${id}`)).status).toBe(200);
    expect((await call(db, "DELETE", `/api/templates/${id}`)).status).toBe(404);
    db.close();
  });

  it("a shipped one is reset (409 for a custom one) and refuses deletion", async () => {
    const db = new BoardDb(":memory:");
    const shipped = db.listTemplates().find((t) => t.key === "reviewer")!;
    await call(db, "PATCH", `/api/templates/${shipped.id}`, { brief: "changed" });
    expect((await call(db, "POST", `/api/templates/${shipped.id}/reset`)).body.template.brief).toBe(shipped.brief);
    expect((await call(db, "DELETE", `/api/templates/${shipped.id}`)).status).toBe(409);
    const mine = db.createTemplate({ name: "m", brief: "b" });
    expect((await call(db, "POST", `/api/templates/${mine.id}/reset`)).status).toBe(409);
    db.close();
  });

  it("is write-gated", async () => {
    const db = new BoardDb(":memory:");
    const guard = (level: string) => (level === "write" ? new Response("no", { status: 403 }) : null);
    expect((await call(db, "POST", "/api/templates", { name: "n", brief: "b" }, { guard })).status).toBe(403);
    expect((await call(db, "GET", "/api/templates", undefined, { guard })).status).toBe(200);
    db.close();
  });

  it("draft returns what the copilot wrote and saves nothing; a half answer is a 502", async () => {
    const db = new BoardDb(":memory:");
    const before = db.listTemplates().length;
    const good = await call(db, "POST", "/api/templates/draft", { description: "a security reviewer" }, {
      copilot: { ask: async () => ({ name: "Security", brief: "Check auth.", model: "opus" }) },
    });
    expect(good.body.draft).toMatchObject({ name: "Security", brief: "Check auth.", model: "opus" });
    const half = await call(db, "POST", "/api/templates/draft", { description: "x" }, { copilot: { ask: async () => ({ name: "n" }) } });
    expect(half.status).toBe(502);
    const off = await call(db, "POST", "/api/templates/draft", { description: "x" }, { cfg: { boardCopilot: false } });
    expect(off.status).toBe(409);
    expect((await call(db, "POST", "/api/templates/draft", {})).status).toBe(400);
    expect(db.listTemplates()).toHaveLength(before);
    db.close();
  });

  it("import returns candidates from .claude/agents and saves nothing; skips symlinks and big files", async () => {
    const db = new BoardDb(":memory:");
    const repo = mkdtempSync(join(tmpdir(), "collie-imp-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    writeFileSync(join(repo, ".claude", "agents", "impl.md"), "---\nname: impl\ndescription: Does it\nmodel: sonnet\n---\nImplement one ticket.");
    writeFileSync(join(repo, ".claude", "agents", "broken.md"), "no frontmatter");
    writeFileSync(join(repo, ".claude", "agents", "huge.md"), `---\nname: huge\n---\n${"x".repeat(70_000)}`);
    const outside = join(mkdtempSync(join(tmpdir(), "collie-out-")), "evil.md");
    writeFileSync(outside, "---\nname: evil\n---\nbody");
    symlinkSync(outside, join(repo, ".claude", "agents", "link.md"));

    const before = db.listTemplates().length;
    const r = await call(db, "POST", "/api/templates/import", { repoPath: repo });
    expect(r.body.candidates.map((c: { name: string }) => c.name)).toEqual(["impl"]);
    expect(db.listTemplates()).toHaveLength(before);

    expect((await call(db, "POST", "/api/templates/import", { repoPath: "relative/path" })).status).toBe(400);
    expect((await call(db, "POST", "/api/templates/import", { repoPath: tmpdir() })).status).toBe(400);
    db.close();
  });

  it("a card and a phase take a templateId that exists, and only that", async () => {
    const db = new BoardDb(":memory:");
    const t = db.listTemplates()[0]!;
    const card = db.createCard({ title: "c", repoPath: "/r" });
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { templateId: t.id })).status).toBe(200);
    expect(db.getCard(card.id)!.templateId).toBe(t.id);
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { templateId: "nope" })).status).toBe(400);
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { templateId: null })).status).toBe(200);

    const phase = db.createPhase({ repoPath: "/r", name: "P" });
    expect((await call(db, "PATCH", `/api/phases/${phase.id}`, { templateId: t.id })).body.phase.templateId).toBe(t.id);
    expect((await call(db, "PATCH", `/api/phases/${phase.id}`, { templateId: "nope" })).status).toBe(400);
    db.close();
  });
});
