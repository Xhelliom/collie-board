import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { BoardDb } from "./db.ts";
import { LATE_COMMITS, LateCommits, QUIET_MS, SCAN_EVERY_MS } from "./late-commits.ts";
import { orchestratorLabel } from "./orchestrator.ts";
import { lateMessage, OrchestratorNudger } from "./orchestrator-nudge.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const T0 = 1_800_000_000_000;
const BRANCH = "board/x";
const snap = { bridge: "connected" } as EngineSnapshot;

/** A repo with a card's branch, real git; every commit is dated by the test's clock. */
function world() {
  const time = { clock: T0 };
  const dir = mkdtempSync(join(tmpdir(), "late-"));
  const sh = (...args: string[]) => {
    const p = Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...gitFreeEnv, GIT_COMMITTER_DATE: `@${Math.floor(time.clock / 1000)} +0000` } });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  };
  const commit = (file: string) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), `${time.clock}\n`);
    sh("add", "-f", "."), sh("commit", "-qm", file);
  };
  sh("init", "-q", "-b", "main"), sh("config", "user.email", "t@t"), sh("config", "user.name", "t");
  commit("base.txt");
  sh("checkout", "-q", "-b", BRANCH);
  commit("work.txt");

  const db = new BoardDb(":memory:", () => time.clock);
  const card = db.createCard({ title: "fond d'écran", repoPath: dir, branch: BRANCH, baseRef: "main", status: "done" });
  const late = () => db.listEventsOf(card.id, [LATE_COMMITS]).map((e) => e.payload as { count: number });
  /** One scan now, and one once the branch has been quiet long enough to be examined. */
  const settle = async (watch: LateCommits) => {
    time.clock += SCAN_EVERY_MS;
    await watch.update(snap);
    time.clock += QUIET_MS + SCAN_EVERY_MS;
    await watch.update(snap);
  };
  return { time, sh, commit, db, card, late, settle, watch: () => new LateCommits(db, undefined, () => time.clock) };
}

describe("LateCommits — commits on a merged card's branch", () => {
  it("says nothing of a merged branch nobody touched, nor of the closing note committed under .board/", async () => {
    const w = world();
    w.sh("checkout", "-q", "main"), w.sh("merge", "-q", "--no-ff", BRANCH, "-m", "merge");
    w.db.recordEvent(w.card.id, "card.merged", { branch: BRANCH, base: "main" });
    const watch = w.watch();
    await w.settle(watch);
    w.sh("checkout", "-q", BRANCH), w.commit(".board/wrapup.md");
    await w.settle(watch);
    expect(w.late()).toEqual([]);
  });

  it("journals the commits made after the merge, once per head — a restart does not say it again", async () => {
    const w = world();
    w.sh("checkout", "-q", "main"), w.sh("merge", "-q", "--no-ff", BRANCH, "-m", "merge");
    w.db.recordEvent(w.card.id, "card.merged", { branch: BRANCH, base: "main" });
    const watch = w.watch();
    await watch.update(snap);

    w.time.clock += 5 * 60_000;
    w.sh("checkout", "-q", BRANCH), w.commit("repli-http.txt"), w.commit("after-load.txt");
    w.time.clock += SCAN_EVERY_MS;
    await watch.update(snap);
    expect(w.late()).toEqual([]); // it just moved: not yet

    await w.settle(watch);
    expect(w.late()).toMatchObject([{ count: 2, branch: BRANCH, base: "main" }]);
    await w.settle(watch);
    await w.settle(w.watch());
    expect(w.late()).toHaveLength(1);

    w.commit("mesures.txt");
    await w.settle(watch);
    expect(w.late().map((p) => p.count)).toEqual([2, 3]);
  });

  it("after a squash-merge, counts only what came after it", async () => {
    const w = world();
    w.sh("checkout", "-q", "main"), w.sh("merge", "-q", "--squash", BRANCH), w.sh("commit", "-qm", "squash");
    w.time.clock += 60_000;
    w.db.recordEvent(w.card.id, "card.pr_merged", { url: "u" });
    const watch = w.watch();
    await w.settle(watch);
    expect(w.late()).toEqual([]);

    w.sh("checkout", "-q", BRANCH), w.commit("late.txt");
    await w.settle(watch);
    expect(w.late()).toMatchObject([{ count: 1 }]);
  });

  it("ignores a card that never landed, and a disconnected snapshot", async () => {
    const w = world();
    w.time.clock += 60_000;
    w.commit("more.txt");
    await w.settle(w.watch());
    w.db.recordEvent(w.card.id, "card.merged", { branch: BRANCH, base: "main" });
    const down = w.watch();
    await down.update({ bridge: "disconnected" } as EngineSnapshot);
    w.time.clock += QUIET_MS + SCAN_EVERY_MS;
    await down.update({ bridge: "disconnected" } as EngineSnapshot);
    expect(w.late()).toEqual([]);
  });

  it("the orchestrator of the repo is told, with the branch to read", async () => {
    const w = world();
    const sent: string[] = [];
    const herdr = { getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }), promptAgent: async (o: { text: string }) => void sent.push(o.text), sendPaneKeys: async () => {} } as never;
    const nudger = new OrchestratorNudger(w.db, herdr);
    w.db.recordEvent(w.card.id, LATE_COMMITS, { branch: BRANCH, base: "main", count: 2, head: "abc" });
    nudger.update({ bridge: "connected", shellPanes: [], agents: [{ paneId: "o1", workspaceLabel: orchestratorLabel(w.card.repoPath!), cwd: w.card.repoPath, status: "idle" }] } as unknown as EngineSnapshot);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([lateMessage(w.card, 2, BRANCH, "main")]);
    expect(sent[0]).toContain(`git log main..${BRANCH}`);
  });
});
