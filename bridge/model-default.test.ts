import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILTIN_ADAPTERS } from "./adapters.ts";
import { BoardDb } from "./db.ts";
import { opencodeChoices, readOpencodeChoices, stripJsonc } from "./model-choices.ts";
import { MODEL_FILE_MARK, modelFileDir, modelSpec, syncModelFile } from "./model-file.ts";

const oc = BUILTIN_ADAPTERS.opencode;

describe("the repo's default model per harness", () => {
  it("strips JSONC comments and trailing commas, never inside a string", () => {
    const text = `{ // c\n "u": "http://x//y", /* b */ "a": [1,], }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({ u: "http://x//y", a: [1] });
  });

  it("offers configured and credentialed providers, config models first, variants from either source", () => {
    const config = { providers: { l40s: { name: "VM", models: { qwen38: { name: "Q", capabilities: { reasoning: { effort: ["low", "xhigh"] } } } } } } };
    const catalog = {
      anthropic: { name: "Anthropic", models: { "claude-x": { name: "X", reasoning_options: [{ type: "effort", values: ["low", "high"] }] }, plain: {} } },
      unused: { models: { m: {} } },
    };
    expect(opencodeChoices(config, catalog, ["anthropic"])).toEqual([
      { id: "l40s", name: "VM", models: [{ id: "qwen38", name: "Q", efforts: ["low", "xhigh"] }] },
      { id: "anthropic", name: "Anthropic", models: [{ id: "claude-x", name: "X", efforts: ["low", "high"] }, { id: "plain", name: undefined, efforts: [] }] },
    ]);
    // v1 config: `provider`, variants as keys.
    expect(opencodeChoices({ provider: { p: { models: { m: { variants: { fast: {} } } } } } }, null, [])[0]!.models[0]!.efforts).toEqual(["fast"]);
  });

  it("reads OpenCode's files; auth.json gives names only; a missing file is an empty list", () => {
    const home = mkdtempSync(join(tmpdir(), "oc-"));
    expect(readOpencodeChoices({}, home)).toEqual([]);
    const env = { XDG_CONFIG_HOME: join(home, "c"), XDG_CACHE_HOME: join(home, "k"), XDG_DATA_HOME: join(home, "d") };
    for (const d of ["c/opencode", "k/opencode", "d/opencode"]) Bun.spawnSync(["mkdir", "-p", join(home, d)]);
    writeFileSync(join(home, "c/opencode/opencode.jsonc"), `{ // x\n "providers": { "l40s": { "models": { "q": {} } } } }`);
    writeFileSync(join(home, "d/opencode/auth.json"), JSON.stringify({ openai: { type: "api", key: "sk-SECRET" } }));
    const out = readOpencodeChoices(env, home);
    expect(out.map((p) => p.id)).toEqual(["l40s", "openai"]);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("writes the board's opencode.json beside the worktrees, removes it at None, never touches the operator's", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-"));
    const path = join(dir, "opencode.json");
    const m = { provider: "l40s-2", model: "qwen38", effort: "low" };
    expect(modelSpec(m)).toBe("l40s-2/qwen38#low");
    expect(modelSpec({ provider: null, model: "--x", effort: null })).toBeNull();
    expect(syncModelFile(oc, dir, null)).toBe("none");
    expect(syncModelFile(oc, dir, m)).toBe("written");
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ $comment: MODEL_FILE_MARK, model: "l40s-2/qwen38#low" });
    expect(syncModelFile(oc, dir, { provider: null, model: null, effort: null })).toBe("removed");
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, `{"model":"mine/own"}`);
    expect(syncModelFile(oc, dir, m)).toBe("kept");
    expect(syncModelFile(oc, dir, null)).toBe("kept");
    expect(readFileSync(path, "utf8")).toBe(`{"model":"mine/own"}`);
    expect(syncModelFile(BUILTIN_ADAPTERS.claude, dir, m)).toBe("none");
  });

  it("puts the file beside a worktree, never beside the main checkout", () => {
    expect(modelFileDir("/h/.herdr/worktrees/repo/card-a", "/h/git/repo")).toBe("/h/.herdr/worktrees/repo");
    expect(modelFileDir("/h/git/repo", "/h/git/repo")).toBeNull();
    expect(modelFileDir("/h/git/repo-wt", "/h/git/repo")).toBeNull();
  });

  it("migrates the Claude-only default into Claude's entry and keeps the others apart", () => {
    const db = new BoardDb(":memory:");
    const raw = (db as unknown as { db: { exec(s: string): void } }).db;
    raw.exec("INSERT INTO repo_pref (path, model, effort, updated_at) VALUES ('/r', 'opus', 'medium', 0)");
    (db as unknown as { migrate(): void }).migrate();
    expect(db.repoModel("/r", "claude")).toEqual({ provider: null, model: "opus", effort: "medium" });
    db.setRepoModel("/r", "opencode", { provider: "l40s", model: "qwen38", effort: "xhigh" });
    (db as unknown as { migrate(): void }).migrate();
    expect(db.repoModels("/r")).toEqual({
      claude: { provider: null, model: "opus", effort: "medium" },
      opencode: { provider: "l40s", model: "qwen38", effort: "xhigh" },
    });
    db.setRepoModel("/r", "claude", null);
    db.setRepoModel("/r", "opencode", null);
    expect(db.dump().repo_pref).toHaveLength(0);
    db.close();
  });
});
