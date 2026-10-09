import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { suggestGate, suggestPrompt, toGateSuggestion } from "./gate-suggest.ts";

const ok = { command: "bun run test", reason: "package.json scripts.test" };

describe("toGateSuggestion (ADR 0020)", () => {
  it("accepts a plain command, trimmed", () => {
    expect(toGateSuggestion({ ...ok, command: "  bun run test " })).toEqual({
      command: "bun run test",
      reason: "package.json scripts.test",
      needsScript: false,
      scriptSuggestion: null,
    });
  });

  it("keeps the script only when one is needed", () => {
    expect(toGateSuggestion({ ...ok, command: "scripts/gate.sh", needsScript: true, scriptSuggestion: "set -e\nmake" })).toMatchObject({
      needsScript: true,
      scriptSuggestion: "set -e\nmake",
    });
    expect(toGateSuggestion({ ...ok, scriptSuggestion: "ignored" }).scriptSuggestion).toBeNull();
  });

  it("throws on anything malformed, never guesses", () => {
    expect(() => toGateSuggestion(null)).toThrow();
    expect(() => toGateSuggestion("make")).toThrow();
    expect(() => toGateSuggestion({ ...ok, command: "  " })).toThrow(/no command/);
    expect(() => toGateSuggestion({ ...ok, reason: "" })).toThrow(/no reason/);
    expect(() => toGateSuggestion({ ...ok, needsScript: true })).toThrow(/without a script/);
  });

  it("refuses a command that needs a shell", () => {
    for (const command of ["make && make test", "make | tee out", "echo $HOME", 'bun run "test"', "a; b", "make > log"])
      expect(() => toGateSuggestion({ ...ok, command })).toThrow(/needs a shell/);
  });

  it("the prompt names the repo, the answer file and the no-shell rule", () => {
    const p = suggestPrompt({ repoPath: "/r/app", outPath: "out/1.json" });
    expect(p).toContain("/r/app");
    expect(p).toContain("out/1.json");
    expect(p).toContain("WITHOUT A SHELL");
  });
});

describe("suggestGate", () => {
  it("passes a good answer through, and reports silence and nonsense apart", async () => {
    expect(await suggestGate(async () => ok, "/r")).toMatchObject({ ok: true, suggestion: { command: "bun run test" } });
    expect(await suggestGate(async () => null, "/r")).toMatchObject({ ok: false, kind: "no-answer" });
    expect(await suggestGate(async () => ({ command: "a && b", reason: "x" }), "/r")).toMatchObject({ ok: false, kind: "malformed" });
  });
});

describe("repo gate routes", () => {
  const asked: string[] = [];
  const audited: string[] = [];
  const ctx = (db: BoardDb, o: { copilot?: boolean; answer?: unknown } = {}) =>
    ({
      db,
      copilot: { ask: async (build: (p: string) => string) => (asked.push(build("out.json")), o.answer ?? null) },
      cfg: { boardCopilot: o.copilot ?? true },
      audit: { record: (e: { action: string }) => audited.push(e.action) },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    }) as never;
  const post = (route: string, body: unknown, c: never) =>
    handleBoardRoute(route, new Request(`http://x${route}`, { method: "POST", body: JSON.stringify(body) }), c);
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "collie-gate-"));
    mkdirSync(join(dir, ".git"));
    return dir;
  };

  it("suggest returns the suggestion and saves nothing", async () => {
    const db = new BoardDb(":memory:");
    const dir = repo();
    const res = await post("/api/repos/gate/suggest", { path: dir }, ctx(db, { answer: ok }));
    expect(res!.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, suggestion: { command: "bun run test" } });
    expect(db.repoGate(dir)).toBeNull();
    expect(asked[asked.length - 1]).toContain(dir);
    expect(audited).toContain("repo.gate_suggest");
  });

  it("suggest refuses a non-repo path, a relative one, and the copilot being off — without asking", async () => {
    const db = new BoardDb(":memory:");
    const before = asked.length;
    expect((await post("/api/repos/gate/suggest", { path: tmpdir() }, ctx(db)))!.status).toBe(400);
    expect((await post("/api/repos/gate/suggest", { path: "relative" }, ctx(db)))!.status).toBe(400);
    expect((await post("/api/repos/gate/suggest", {}, ctx(db)))!.status).toBe(400);
    expect((await post("/api/repos/gate/suggest", { path: repo() }, ctx(db, { copilot: false })))!.status).toBe(409);
    expect(asked.length).toBe(before);
  });

  it("suggest answers 502 when the copilot says nothing usable", async () => {
    const res = await post("/api/repos/gate/suggest", { path: repo() }, ctx(new BoardDb(":memory:"), { answer: { command: "a | b", reason: "x" } }));
    expect(res!.status).toBe(502);
    expect(await res!.json()).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("gate saves, normalises whitespace, and clears with null", async () => {
    const db = new BoardDb(":memory:");
    const c = ctx(db);
    expect((await post("/api/repos/gate", { path: "/r", gate: "  make   check " }, c))!.status).toBe(200);
    expect(db.repoGate("/r")).toBe("make check");
    expect((await post("/api/repos/gate", { path: "/r", gate: null }, c))!.status).toBe(200);
    expect(db.repoGate("/r")).toBeNull();
    expect((await post("/api/repos/gate", { path: "/r", gate: "   " }, c))!.status).toBe(400);
    expect((await post("/api/repos/gate", { path: "/r", gate: 3 }, c))!.status).toBe(400);
  });
});
