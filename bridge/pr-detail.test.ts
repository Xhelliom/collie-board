import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import type { GitRunner } from "./git.ts";
import { parsePrDetail, parsePrNumber, prDetail } from "./pr-detail.ts";

const VIEW = JSON.stringify({
  number: 7,
  title: "Fix it",
  body: "## Why\nbecause",
  author: { login: "ana" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  baseRefName: "main",
  headRefName: "board/fix",
  state: "OPEN",
  mergeable: "MERGEABLE",
  isDraft: false,
  url: "https://github.com/o/r/pull/7",
  files: [{ path: "a.ts", additions: 3, deletions: 1 }, { nope: 1 }],
});

describe("the PR number", () => {
  it("accepts only a plain positive integer", () => {
    expect(parsePrNumber("12")).toBe(12);
    for (const bad of ["0", "-1", "1.5", "1e3", "--web", "12 ", "", "abc"]) expect(parsePrNumber(bad)).toBeNull();
  });
});

describe("parsePrDetail", () => {
  it("shapes what gh said, dropping a file row without a path", () => {
    const d = parsePrDetail(VIEW)!;
    expect(d).toMatchObject({ number: 7, author: "ana", base: "main", head: "board/fix", state: "open", mergeable: true, conflicting: false, isDraft: false });
    expect(d.files).toEqual([{ path: "a.ts", additions: 3, deletions: 1 }]);
    expect(d.createdAt).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
  it("is null on garbage or a missing number", () => {
    expect(parsePrDetail("nope")).toBeNull();
    expect(parsePrDetail("{}")).toBeNull();
  });
});

describe("prDetail", () => {
  const db = new BoardDb(":memory:");
  db.setRepoListed("/repo", true);
  const gh: GitRunner = async (args) =>
    args[1] === "view" ? { ok: true, stdout: VIEW, stderr: "" } : { ok: true, stdout: "diff --git a/a.ts b/a.ts\n+x\n", stderr: "" };

  it("refuses an unknown repo (403) and a bad number (400) before any gh call", async () => {
    let called = 0;
    const spy: GitRunner = async (a, c) => (called++, gh(a, c));
    expect(await prDetail(db, "/elsewhere", "7", spy)).toMatchObject({ ok: false, status: 403 });
    expect(await prDetail(db, "/repo", "--web", spy)).toMatchObject({ ok: false, status: 400 });
    expect(called).toBe(0);
  });
  it("returns the sheet with its diff for a known repo", async () => {
    const r = await prDetail(db, "/repo", "7", gh);
    expect(r).toMatchObject({ ok: true, detail: { number: 7, diff: expect.stringContaining("+x"), diffTruncated: false, card: null } });
  });
});
