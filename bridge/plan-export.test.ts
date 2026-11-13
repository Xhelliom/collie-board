import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BoardDb, type Run } from "./db.ts";
import { runGit, type GitRunner } from "./git.ts";
import { exportPlanAtLotEnd, lotBilanMarkdown, lotSlugOf, openPlanPr, planTitle, rollingPlanPr } from "./plan-export.ts";
import { RunCoordinator, type RunPorts } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const git = async (args: string[], cwd: string, stdin?: string) => {
  const r = await runGit(args, cwd, stdin);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A clone of a bare origin with one commit on main holding `docs/keep.md`. */
async function repoWithOrigin(): Promise<{ repo: string; origin: string }> {
  const root = await mkdtemp(join(tmpdir(), "collie-plan-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  await git(["init", "--bare", "-b", "main", origin], root);
  await git(["init", "-b", "main", repo], root);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) await git(["config", k!, v!], repo);
  await Bun.write(join(repo, "docs/keep.md"), "keep\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "init"], repo);
  await git(["remote", "add", "origin", origin], repo);
  await git(["push", "-u", "origin", "main"], repo);
  return { repo, origin };
}

describe("plan export at the end of a lot", () => {
  it("renders the lot's bilan: outcome, PR, the worker's words", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "Ajouter X", repoPath: "/r", status: "done" });
    const run = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0, name: "Lot 1" }) as Run;
    const md = lotBilanMarkdown(run, [{ card: a, report: { issue: "coded", text: "Issue : codé\nX est là." }, prUrl: "https://g/pull/3" }], Date.UTC(2026, 10, 6));
    expect(md).toContain("# Bilan du lot — Lot 1\n\n**Statut :** ✅ décidé — lot terminé le 2026-11-06");
    expect(md).toContain("2026-11-06 · 1/1");
    expect(md).toContain("done · codé · https://g/pull/3");
    expect(md).toContain("> X est là.");
  });

  it("pushes a new branch with docs/plan on origin's base, opens the PR, never moves the base", async () => {
    const { repo, origin } = await repoWithOrigin();
    const mainBefore = await git(["rev-parse", "main"], origin);
    const ghCalls: string[][] = [];
    const gh: GitRunner = async (args) => (ghCalls.push(args), { ok: true, stdout: "https://github.com/o/r/pull/9\n", stderr: "" });
    const files = { "docs/plan/roadmap.md": "# R\n", "docs/plan/lots/lot-a-123456.md": "# B\n" };
    const r = await openPlanPr(repo, { base: "main", branch: "board/plan-lot-a-123456", title: "docs(plan): x", body: "b", files }, runGit, gh);
    expect(r).toEqual({ ok: true, url: "https://github.com/o/r/pull/9" });
    expect(await git(["rev-parse", "main"], origin)).toBe(mainBefore);
    expect(await git(["show", "board/plan-lot-a-123456:docs/plan/lots/lot-a-123456.md"], origin)).toBe("# B");
    expect(await git(["show", "board/plan-lot-a-123456:docs/keep.md"], origin)).toBe("keep"); // the rest of the tree is kept
    expect(await git(["rev-parse", "board/plan-lot-a-123456^"], origin)).toBe(mainBefore);
    expect(ghCalls[0]).toEqual(["pr", "create", "--base", "main", "--head", "board/plan-lot-a-123456", "--title", "docs(plan): x", "--body", "b"]);

    // Already up to date on the base: no branch, no PR.
    const same = await openPlanPr(repo, { base: "main", branch: "board/plan-y", title: "t", body: "b", files: { "docs/keep.md": "keep\n" } }, runGit, gh);
    expect(same).toMatchObject({ ok: true, skipped: expect.any(String) });
    expect(ghCalls).toHaveLength(1);
  });

  it("is on by default and the repo's switch cuts it", async () => {
    const db = new BoardDb(":memory:");
    expect(db.planExportOf("/r")).toBe(true);
    db.setPlanExport("/r", false);
    expect(db.planExportOf("/r")).toBe(false);
    const run = db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 0 }) as Run;
    const never: GitRunner = async () => {
      throw new Error("no git when off");
    };
    expect(await exportPlanAtLotEnd(db, run, never, never)).toEqual({ ok: true, skipped: "export off for this repo" });
    db.setPlanExport("/r", true);
    expect(db.planExportOf("/r")).toBe(true);
  });

  it("names the bilan and the branch after the lot", () => {
    expect(lotSlugOf({ id: "abcdef99", name: "Été 2026" })).toBe("lot-ete-2026-abcdef");
  });

  it("the coordinator hands the finished lot over once, on the tick that journals run.finished", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "done" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const finished: string[] = [];
    const ports = { reviewing: () => false, direct: () => false, freeSlots: () => 1, lotFinished: (r: Run) => finished.push(r.id) } as unknown as RunPorts;
    const coord = new RunCoordinator(db, ports);
    const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" } as unknown as EngineSnapshot;
    coord.update(snap);
    coord.update(snap);
    expect(finished).toEqual([a.runId ?? db.getCard(a.id)!.runId!]);
  });
});

describe("the rolling docs(plan) PR", () => {
  const pr = (number: number, branch: string) => ({ number, title: "t", url: `https://g/pull/${number}`, branch, createdAt: null, conflicting: false, mergeable: true, checks: null, review: null, draft: false });

  it("picks the newest open plan PR, ignores the others", () => {
    expect(rollingPlanPr([pr(3, "board/plan-lot-a"), pr(9, "board/plan-lot-b"), pr(12, "board/feat")])?.number).toBe(9);
    expect(rollingPlanPr([pr(12, "board/feat")])).toBeNull();
    expect(planTitle(["A"])).toBe("docs(plan): fin du lot « A »");
    expect(planTitle(["A", "B", "C"])).toBe("docs(plan): fin des lots A, B, C");
  });

  it("a second lot end pushes a commit on the existing branch, retitles it, catches up missing bilans", async () => {
    const { repo, origin } = await repoWithOrigin();
    const mainBefore = await git(["rev-parse", "main"], origin);
    const db = new BoardDb(":memory:");
    const mk = (name: string) => {
      const c = db.createCard({ title: name, repoPath: repo, status: "done" });
      return db.createRun({ repoPath: repo, cardIds: [c.id], foldInCap: 0, name }) as Run;
    };
    const a = mk("Lot A");
    const b = mk("Lot B");
    const ghCalls: string[][] = [];
    let open: unknown[] = [];
    const gh: GitRunner = async (args) => {
      ghCalls.push(args);
      if (args[1] === "list") return { ok: true, stdout: JSON.stringify(open), stderr: "" };
      return { ok: true, stdout: "https://github.com/o/r/pull/7\n", stderr: "" };
    };
    // Both lots finished: bilans are journaled by the coordinator in production; here stub the read.
    const finished = new Set([a.id, b.id]);
    (db as unknown as { runFinishedAt: (id: string) => number | null }).runFinishedAt = (id) => (finished.has(id) ? Date.UTC(2026, 10, 1) : null);

    // First end (lot A): no open PR → a new one, titled for the lot, and it catches up lot B.
    const first = await exportPlanAtLotEnd(db, a, runGit, gh);
    expect(first).toMatchObject({ ok: true, url: "https://github.com/o/r/pull/7" });
    const branch = `board/plan-${lotSlugOf(a)}`;
    expect(ghCalls.some((c) => c[1] === "create" && c.includes("docs(plan): fin des lots Lot B, Lot A"))).toBe(true);
    expect(await git(["show", `${branch}:docs/plan/lots/${lotSlugOf(b)}.md`], origin)).toContain("Lot B");
    const tip1 = await git(["rev-parse", branch], origin);

    // Second end (lot B): the PR is open → no create, a commit on ITS branch, retitled.
    ghCalls.length = 0;
    open = [{ number: 7, title: "x", url: "https://github.com/o/r/pull/7", headRefName: branch }];
    const second = await exportPlanAtLotEnd(db, b, runGit, gh);
    expect(second).toMatchObject({ ok: true });
    expect(ghCalls.some((c) => c[1] === "create")).toBe(false);
    expect(ghCalls).toContainEqual(["pr", "edit", "7", "--title", "docs(plan): fin des lots Lot A, Lot B"]);
    expect(await git(["rev-parse", `${branch}^`], origin)).toBe(tip1);
    expect(await git(["show", `${branch}:docs/plan/lots/${lotSlugOf(a)}.md`], origin)).toContain("Lot A");
    expect(await git(["rev-parse", "main"], origin)).toBe(mainBefore); // the base is never pushed
  });
});
