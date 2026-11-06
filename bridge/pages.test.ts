import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import type { BoardContext } from "./board-routes.ts";
import { loadConfig } from "./config.ts";
import { handleDocsRoute, PAGE_CSP } from "./docs.ts";
import { isSafePageName, parsePageTree } from "./git.ts";
import { checkAccess } from "./server.ts";

// Custom project pages (docs/pages/<name>.html on main) — ADR 0053: served scrubbed under their OWN
// sandbox CSP; the board's CSP and checkAccess stay exactly as they were.

function sh(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

function repo(withPages: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "pages-"));
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "# x\n");
  if (withPages) {
    mkdirSync(join(dir, "docs/pages/nested"), { recursive: true });
    writeFileSync(join(dir, "docs/pages/marketing.html"), '<style>h1{color:red}</style><h1 onclick="x()">Plan</h1><script>fetch("/api/cards")</script>');
    writeFileSync(join(dir, "docs/pages/direction-artistique.html"), "<h1>DA</h1>");
    writeFileSync(join(dir, "docs/pages/notes.md"), "# not a page");
    writeFileSync(join(dir, "docs/pages/nested/deep.html"), "<p>deep</p>");
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "init");
  return dir;
}

const ctx = {
  guard: () => null,
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  text: (body: string, status: number) => new Response(body, { status }),
} as unknown as BoardContext;
const get = (path: string) => handleDocsRoute(new URL(path, "http://h").pathname, new Request(`http://h${path}`), ctx) as Promise<Response>;

describe("custom pages", () => {
  test("a page name can't climb, hide an extension or start like an option", () => {
    expect(["marketing", "direction-artistique", "plan_2026", "été"].every(isSafePageName)).toBe(true);
    expect(["", "../x", "a.b", "-x", "a/b", ".x", "x".repeat(81)].some(isSafePageName)).toBe(false);
    expect(parsePageTree(["100644 blob abc 12\tdocs/pages/a.html", "100644 blob abc 1\tdocs/pages/b.md", "040000 tree abc -\tdocs/pages/n", ""].join("\0"))).toEqual([{ name: "a", size: 12 }]);
  });

  test("lists the top-level .html of docs/pages on main — none without the folder", async () => {
    const dir = repo(true);
    expect(await (await get(`/api/docs/pages?repo=${encodeURIComponent(dir)}`)).json()).toEqual({
      ref: "main",
      pages: [{ name: "direction-artistique", size: 11 }, expect.objectContaining({ name: "marketing" })],
    });
    const bare = repo(false);
    expect((await (await get(`/api/docs/pages?repo=${encodeURIComponent(bare)}`)).json()).pages).toEqual([]);
  });

  test("serves a page scrubbed, under its own sandbox CSP with no network; unknown or unsafe names 404", async () => {
    const dir = repo(true);
    const res = await get(`/api/docs/page?repo=${encodeURIComponent(dir)}&name=marketing`);
    expect(res.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(PAGE_CSP).toStartWith("sandbox;");
    expect(PAGE_CSP).toContain("default-src 'none'");
    expect(PAGE_CSP).not.toContain("allow-");
    const body = await res.text();
    expect(body).toContain("<style>h1{color:red}</style>");
    expect(body).not.toContain("script");
    expect(body).not.toContain("onclick");
    for (const name of ["../README", "notes", "nested/deep", "absent"]) {
      expect((await get(`/api/docs/page?repo=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`)).status).toBe(404);
    }
  });

  test("the board's CSP is unchanged, and a request from the sandbox's opaque origin is refused", () => {
    const server = readFileSync(join(import.meta.dir, "server.ts"), "utf8");
    expect(server).toContain(
      `"default-src 'self'; connect-src 'self'; img-src 'self' data:; " +\n  "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; " +\n  "manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'"`,
    );
    const cfg = loadConfig();
    const req = (origin?: string) => new Request("http://h/api/cards", { headers: { host: "h", ...(origin ? { origin } : {}) } });
    expect(checkAccess(req("null"), cfg).ok).toBe(false);
    expect(checkAccess(req("http://h"), cfg).ok).toBe(true);
  });
});
