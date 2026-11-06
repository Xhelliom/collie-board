import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { buildIndex, docMeta, META_PATTERN, parseDocPaths, rubricOf } from "./docs.ts";
import { docsOnRef, grepDocsOnRef, isSafeDocPath, readDocOnRef, type GitRunner } from "./git.ts";

function sh(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A repo whose `main` holds a few docs, then a branch and an uncommitted file that must stay unseen. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-"));
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, ".adr"));
  mkdirSync(join(dir, "docs/plan"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Le projet\n\nVoir [le plan](docs/plan/phase-1.md).\n");
  writeFileSync(join(dir, ".adr/0001-one-door.md"), "# 0001 — One door\n\n**Status:** Accepted\n**Date:** 2026-09-01\n");
  writeFileSync(join(dir, ".adr/0002-two.md"), "# 0002 — Two\n\n**Statut :** 🟡 piste\n**Date :** 2026-10-02\n");
  writeFileSync(join(dir, "docs/plan/phase-1.md"), "# Phase 1\n\nLe mot girafe est ici.\n");
  writeFileSync(join(dir, "NOTES.md"), "pas de titre\n");
  writeFileSync(join(dir, "code.ts"), "// # not a doc\n");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "docs");
  sh(dir, "switch", "-qc", "board/x");
  writeFileSync(join(dir, "BRANCH.md"), "# Only on the branch\n");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "branch");
  writeFileSync(join(dir, "DIRTY.md"), "# Uncommitted\n");
  return dir;
}

describe("isSafeDocPath", () => {
  test.each(["README.md", ".adr/0001-x.md", "docs/plan/phase-1.md"])("accepts %s", (p) => expect(isSafeDocPath(p)).toBe(true));
  test.each(["", "../x.md", "docs/../x.md", "/etc/x.md", "./x.md", "-x.md", "a\\b.md", "a\0.md", "x.txt", "docs//x.md", "a/".repeat(300) + "x.md"])(
    "refuses %j",
    (p) => expect(isSafeDocPath(p)).toBe(false),
  );
});

describe("reading the default branch's tree", () => {
  const dir = repo();

  test("lists the .md of main only — not the branch's, not the working copy's", async () => {
    const docs = (await docsOnRef(dir, "main"))!.map((d) => d.path).sort();
    expect(docs).toEqual([".adr/0001-one-door.md", ".adr/0002-two.md", "NOTES.md", "README.md", "docs/plan/phase-1.md"]);
  });

  test("reads a file of main; absent, off-branch or unsafe paths read as null", async () => {
    expect((await readDocOnRef(dir, "main", "docs/plan/phase-1.md"))!.text).toContain("girafe");
    expect(await readDocOnRef(dir, "main", "BRANCH.md")).toBeNull();
    expect(await readDocOnRef(dir, "main", "DIRTY.md")).toBeNull();
    expect(await readDocOnRef(dir, "main", "../README.md")).toBeNull();
    expect(await readDocOnRef(dir, "main", "docs/plan")).toBeNull();
  });

  test("the path reaches git only after --, and an unsafe one never reaches it", async () => {
    const calls: string[][] = [];
    const fake: GitRunner = async (args) => (calls.push(args), { ok: false, stdout: "", stderr: "" });
    await readDocOnRef(dir, "main", "docs/x.md", fake);
    await readDocOnRef(dir, "main", "../x.md", fake);
    expect(calls).toEqual([["ls-tree", "-z", "-l", "--full-tree", "main", "--", "docs/x.md"]]);
  });

  test("search: case-insensitive literal over main's .md", async () => {
    expect((await grepDocsOnRef(dir, "main", "GIRAFE", "paths")).map((l) => l.path)).toEqual(["docs/plan/phase-1.md"]);
    expect(await grepDocsOnRef(dir, "main", "-not-an-option", "paths")).toEqual([]);
    expect(await grepDocsOnRef(dir, "main", "Only on the branch", "paths")).toEqual([]);
  });

  test("the index: rubrics, « Autres », ADR statuses and dates merged with the roadmap, newest first", async () => {
    const rubrics = parseDocPaths(readFileSync(join(import.meta.dir, "../docs/conventions/DOC_CONVENTION.md"), "utf8"))!;
    const lines = await grepDocsOnRef(dir, "main", META_PATTERN, "lines");
    const roadmap = { decisions: [{ id: "d1", text: "Le dépôt fait foi", status: "decided" as const }], updatedAt: Date.parse("2026-11-06T10:00:00Z") };
    const idx = buildIndex("main", (await docsOnRef(dir, "main"))!, lines, rubrics, roadmap);
    expect(idx.rubrics.map((r) => r.id)).toEqual(["adr", "plan", "readme"]);
    expect(idx.other.map((d) => [d.path, d.title])).toEqual([["NOTES.md", "NOTES.md"]]);
    expect(idx.rubrics.find((r) => r.id === "readme")!.docs[0]!.title).toBe("Le projet");
    expect(idx.decisions).toEqual([
      { kind: "roadmap", id: "d1", text: "Le dépôt fait foi", status: "decided", date: "2026-11-06" },
      { kind: "adr", path: ".adr/0002-two.md", title: "0002 — Two", status: "🟡 piste", date: "2026-10-02" },
      { kind: "adr", path: ".adr/0001-one-door.md", title: "0001 — One door", status: "Accepted", date: "2026-09-01" },
    ]);
  });
});

describe("the convention's doc-paths", () => {
  const rubrics = parseDocPaths(readFileSync(join(import.meta.dir, "../docs/conventions/DOC_CONVENTION.md"), "utf8"))!;

  test("socle then modules, one rubric per id — architecture's paths merged", () => {
    expect(rubrics[0]!.id).toBe("index");
    expect(rubrics.filter((r) => r.id === "architecture")).toHaveLength(1);
    expect(rubrics.find((r) => r.id === "architecture")!.paths).toContain("docs/ARCHITECTURE.md");
  });

  test("a folder by prefix, a file by its exact path, else null", () => {
    expect(rubricOf(".adr/0001.md", rubrics)).toBe("adr");
    expect(rubricOf("CLAUDE.md", rubrics)).toBe("agents");
    expect(rubricOf("web/CLAUDE.md", rubrics)).toBeNull();
  });

  test("no block, or a broken one, is null", () => {
    expect(parseDocPaths("# nothing")).toBeNull();
    expect(parseDocPaths("```json doc-paths\n{oops\n```")).toBeNull();
  });

  test("docMeta: the first heading, status and date of each file", () => {
    const m = docMeta([
      { path: "a.md", line: 3, text: "# Second" },
      { path: "a.md", line: 1, text: "# First" },
      { path: "a.md", line: 2, text: "**Statut :** ✅ décidé" },
    ]);
    expect(m.get("a.md")).toEqual({ title: "First", status: "✅ décidé", date: null });
  });
});
