import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import type { GitRunner } from "./git.ts";
import { handleBoardRoute, PANE_HEADER } from "./board-routes.ts";
import { parseCheckRows, parsePrDetail, parsePrNumber, prDetail, prRerun } from "./pr-detail.ts";

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

describe("parseCheckRows", () => {
  it("maps CheckRun and StatusContext states, and finds the run id", () => {
    const rows = parseCheckRows([
      { name: "a", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z", detailsUrl: "https://github.com/o/r/actions/runs/123/job/9" },
      { name: "b", status: "COMPLETED", conclusion: "FAILURE" },
      { name: "c", status: "IN_PROGRESS", conclusion: "" },
      { name: "d", status: "COMPLETED", conclusion: "SKIPPED" },
      { name: "e", status: "COMPLETED", conclusion: "CANCELLED" },
      { context: "ci/x", state: "PENDING", targetUrl: "https://ci/x" },
      { context: "ci/y", state: "ERROR" },
    ]);
    expect(rows.map((r) => r.state)).toEqual(["success", "failure", "pending", "skipped", "cancelled", "pending", "failure"]);
    expect(rows[0]).toMatchObject({ runId: "123", completedAt: Date.parse("2026-01-01T00:01:00Z") });
    expect(rows[5]).toMatchObject({ name: "ci/x", runId: null, url: "https://ci/x" });
    expect(parseCheckRows(undefined)).toEqual([]);
  });
});

describe("rerun", () => {
  const db = new BoardDb(":memory:");
  db.setRepoListed("/repo", true);
  it("runs `gh run rerun --failed` for a digit run id only", async () => {
    const seen: string[][] = [];
    const gh: GitRunner = async (a) => (seen.push(a), { ok: true, stdout: "", stderr: "" });
    expect(await prRerun(db, "/repo", "7", "123", gh)).toEqual({ ok: true });
    expect(seen).toEqual([["run", "rerun", "123", "--failed"]]);
    expect(await prRerun(db, "/repo", "7", "--web", gh)).toMatchObject({ ok: false, status: 400 });
    expect(await prRerun(db, "/else", "7", "123", gh)).toMatchObject({ ok: false, status: 403 });
    expect(seen.length).toBe(1);
  });
  it("the route refuses a request carrying x-collie-pane (403)", async () => {
    const req = new Request("http://x/api/board/prs/7/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", [PANE_HEADER]: "p1" },
      body: JSON.stringify({ repo: "/repo", runId: "123" }),
    });
    const res = await handleBoardRoute("/api/board/prs/7/rerun", req, { db, guard: () => null, text: (m: string, status: number) => new Response(m, { status }), json: (b: unknown, status = 200) => Response.json(b, { status }) } as never);
    expect(res!.status).toBe(403);
  });
});
