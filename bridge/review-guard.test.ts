import { describe, expect, test } from "bun:test";

import { BoardDb } from "./db.ts";
import type { GitRunner } from "./git.ts";
import { branchWork, refusalReason, ReviewGuard } from "./review-guard.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** A fake git: `diff` answers the committed question, `status` the working-tree one. */
function fake(opts: { committed?: string; status?: string }): GitRunner {
  return async (args) => {
    if (args[0] === "merge-base") return { ok: true, stdout: "abc123\n", stderr: "" };
    if (args[0] === "diff" && args.includes("HEAD")) return { ok: true, stdout: opts.committed ?? "", stderr: "" };
    if (args[0] === "diff") return { ok: true, stdout: opts.committed ?? "", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: opts.status ?? "", stderr: "" };
    return { ok: false, stdout: "", stderr: "" };
  };
}

describe("branchWork — what the card's branch holds against its base", () => {
  test("a commit on the branch is committed work", async () => {
    expect(await branchWork("/w", "main", fake({ committed: "3\t1\tsrc/a.ts\n" }))).toBe("committed");
  });

  test("files in the checkout and no commit: the work exists, it was never committed", async () => {
    expect(await branchWork("/w", "main", fake({ status: " M src/a.ts\n?? src/b.ts\n" }))).toBe("uncommitted");
  });

  test("nothing at all: nothing was done", async () => {
    expect(await branchWork("/w", "main", fake({}))).toBe("nothing");
  });

  test("the board's own .board/ notes are not the card's work", async () => {
    expect(
      await branchWork("/w", "main", fake({ committed: "1\t0\t.board/handoff.md\n", status: "?? .board/note.md\n" })),
    ).toBe("nothing");
  });
});

describe("refusalReason — names the branch, the base, and the right next move", () => {
  test("nothing: says nothing was done", () => {
    const r = refusalReason("nothing", "card/x", "main");
    expect(r).toContain("card/x");
    expect(r).toContain("main");
    expect(r).toMatch(/nothing/i);
  });

  test("uncommitted: says to commit, which differs from the empty case", () => {
    const r = refusalReason("uncommitted", "card/x", "main");
    expect(r).toContain("card/x");
    expect(r).toContain("main");
    expect(r).toMatch(/uncommitted/i);
    expect(r).not.toBe(refusalReason("nothing", "card/x", "main"));
  });
});

describe("ReviewGuard — the card in review with nothing to review", () => {
  const snap = { bridge: "connected" } as EngineSnapshot;
  const wt = "worktree /w\nHEAD abc\nbranch refs/heads/card/x\n\n";
  const git = (opts: { committed?: string; status?: string }): GitRunner => {
    const inner = fake(opts);
    return async (args, cwd) =>
      args[0] === "worktree" ? { ok: true, stdout: wt, stderr: "" } : inner(args, cwd);
  };
  const make = (patch: Record<string, unknown> = {}) => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "t", repoPath: "/r", branch: "card/x", baseRef: "main", status: "review", ...patch });
    return { db, card };
  };

  test("an empty branch goes back to working, the reason on the card", async () => {
    const { db, card } = make();
    await new ReviewGuard(db, git({})).onUpdate(snap);
    expect(db.getCard(card.id)?.status).toBe("working");
  });

  test("a branch with a commit stays in review", async () => {
    const { db, card } = make();
    await new ReviewGuard(db, git({ committed: "1\t0\ta.ts\n" })).onUpdate(snap);
    expect(db.getCard(card.id)?.status).toBe("review");
  });

  test("an exploration or a card without a branch is never blocked", async () => {
    for (const patch of [{ category: "explore" }, { branch: null }]) {
      const { db, card } = make(patch);
      await new ReviewGuard(db, git({})).onUpdate(snap);
      expect(db.getCard(card.id)?.status).toBe("review");
    }
  });
});
