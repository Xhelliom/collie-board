import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardDb } from "./db.ts";
import { worktreePathFor } from "./git.ts";
import type { Mux, WirePane } from "./mux/mux.ts";
import { closePanes, hcPanesIn, sweepChoice, sweepWorktrees } from "./worktree-sweep.ts";

const pane = (pane_id: string, cwd: string, agent_status = "idle"): WirePane => ({ pane_id, cwd, agent_status }) as WirePane;

test("only hc's terminals in the checkout are closed by hand — herdr 0.9's go with their workspace", () => {
  const panes = [pane("t3", "/wt/x"), pane("t1b", "/wt/x/web"), pane("t4", "/wt/xy"), pane("w1:p1", "/wt/x")];
  expect(hcPanesIn(panes, "/wt/x").map((p) => p.pane_id)).toEqual(["t3", "t1b"]);
});

test("a close refused for another reason than « pane unknown » is written on the card", async () => {
  const db = new BoardDb(":memory:");
  const card = db.createCard({ title: "x" });
  const errors: Record<string, string> = { t1: 'hc terminal.rm: no terminal "t1"', "w1:p1": "pane_not_found: w1:p1", t2: "hc terminal.rm: timed out after 5000ms" };
  const mux = { closePane: async (id: string) => { throw new Error(errors[id]); } } as unknown as Mux;
  await closePanes(db, mux, card.id, ["t1", "w1:p1", "t2"]);
  const failed = db.listEvents(card.id).filter((e) => e.type === "card.cleanup_failed");
  expect(failed.map((e) => e.payload)).toEqual([{ stage: "pane", paneId: "t2", error: errors.t2 }]);
});

test("the sweep removes a filed card's clean checkout, reports a dirty one, leaves the rest", () => {
  expect(sweepChoice({ status: "done", dirty: false, busy: false })).toBe("remove");
  expect(sweepChoice({ status: "archived", dirty: false, busy: false })).toBe("remove");
  expect(sweepChoice({ status: "done", dirty: true, busy: false })).toBe("report");
  expect(sweepChoice({ status: "done", dirty: false, busy: true })).toBe("keep");
  expect(sweepChoice({ status: "working", dirty: false, busy: false })).toBe("keep");
  expect(sweepChoice({ status: "review", dirty: true, busy: false })).toBe("keep");
});

test("at startup: clean worktree of a done card removed with its hc pane, dirty one reported once, live card untouched", async () => {
  const repo = await mkdtemp(join(tmpdir(), "sweep-"));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  await Bun.write(join(repo, "README"), "x\n");
  git("add", ".");
  git("commit", "-qm", "init");
  const db = new BoardDb(":memory:");
  const paths: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const [name, status] of [["clean", "done"], ["dirty", "done"], ["live", "working"]] as const) {
    paths[name] = join(repo, "..", `${repo.split("/").pop()}-${name}`);
    git("worktree", "add", "-q", "-b", `board/${name}`, paths[name]!);
    const card = db.createCard({ title: name, repoPath: repo, baseRef: "main" });
    db.patchCard(card.id, { branch: `board/${name}` });
    db.setStatus(card.id, status, "test");
    ids[name] = card.id;
  }
  await Bun.write(join(paths.clean!, ".board", "bilan.md"), "notes are not work\n");
  await Bun.write(join(paths.dirty!, "wip.ts"), "export {};\n");
  const real = async (n: string) => (await worktreePathFor(repo, `board/${n}`))!;
  const closed: string[] = [];
  const mux = {
    listPanes: async () => [pane("t3", await real("clean")), pane("t4", await real("live")), pane("w1:p1", await real("clean"))],
    closePane: async (id: string) => void closed.push(id),
  } as unknown as Mux;

  const first = await sweepWorktrees(db, mux);
  expect(first.removed.length).toBe(1);
  expect(closed).toEqual(["t3"]);
  expect(await worktreePathFor(repo, "board/clean")).toBeNull();
  expect(await worktreePathFor(repo, "board/dirty")).not.toBeNull();
  expect(await worktreePathFor(repo, "board/live")).not.toBeNull();
  await sweepWorktrees(db, mux);
  expect(db.listEvents(ids.dirty!).filter((e) => e.type === "card.cleanup_failed").length).toBe(1);
  expect(db.listEvents(ids.clean!).some((e) => e.type === "card.worktree_swept")).toBe(true);

  for (const p of [repo, ...Object.values(paths)]) await rm(p, { recursive: true, force: true });
}, 30_000);
