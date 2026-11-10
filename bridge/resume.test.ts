import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import { NO_AGENT_REASON } from "./cards.ts";
import { BoardDb } from "./db.ts";
import { DEFAULT_BUDGET } from "./goal-routes.ts";
import { LeadSilent } from "./lead.ts";
import { orchestratorLabel } from "./orchestrator.ts";
import { MAX_AUTO_RESUMES, mechanicalHalt } from "./resume.ts";

describe("mechanicalHalt (ADR 0055)", () => {
  it.each([
    "PR not merged: merge refused: GraphQL: Head branch is not up to date with the base branch (mergePullRequest)",
    "PR: To github.com:x/y.git\n! [remote rejected]\nerror: failed to push some refs\nhusky - pre-push hook exited with code 1",
    "merge direct: error: failed to push some refs to 'origin'",
    "PR: the card's checkout has uncommitted work — commit it from the agent's pane first, or it will not be integrated",
    "start failed: herdr is not answering",
    NO_AGENT_REASON,
  ])("lifts %s", (reason) => expect(mechanicalHalt({ reason })).toBe(true));

  it("lifts a silent lead by its flag", () => expect(mechanicalHalt({ reason: new LeadSilent(null).message, leadSilent: true })).toBe(true));

  it.each([
    "5 rounds without the lead finding it finished — change it in Project settings → Rounds before calling me",
    // the worker's reply is quoted: its words never make a decision halt mechanical
    "the lead called it finished, yet the branch has no commit. Lead: ok. Worker's last reply: start failed: uncommitted work",
    "the lead says the spec is ambiguous",
    "PR not merged: the check ci failed — not merging",
    "“a”'s PR was closed without merging — its work is not in the base",
    "",
  ])("keeps %s for the operator", (reason) => expect(mechanicalHalt({ reason })).toBe(false));
});

const repo = mkdtempSync(join(tmpdir(), "collie-resume-"));
mkdirSync(join(repo, ".git"));
const ORCH = { "x-collie-pane": "o1" };
const snap = { bridge: "connected", shellPanes: [], workspaces: [], tabs: [], agents: [{ paneId: "o1", workspaceLabel: orchestratorLabel(repo), cwd: repo, status: "idle" }] };

const ctx = (db: BoardDb) =>
  ({
    db,
    herdr: {},
    engine: { current: () => snap },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

function world(reason: string, autonomy = true) {
  const db = new BoardDb(":memory:");
  if (autonomy) db.setAutonomy(repo, { enabled: true, maxChain: null, stopOnRed: false, startWhenIdle: false, maxRounds: 5 });
  const c = db.createCard({ title: "c", repoPath: repo, status: "review" });
  const run = db.createRun({ repoPath: repo, cardIds: [c.id], foldInCap: 0 });
  const halt = () => db.recordRunEvent(c.id, "run.halted", { runId: run.id, reason });
  halt();
  const resume = async (headers: Record<string, string> = ORCH) => {
    const res = await handleBoardRoute(`/api/runs/${run.id}/resume`, new Request(`http://x/api/runs/${run.id}/resume`, { method: "POST", headers }), ctx(db));
    return res!.status;
  };
  return { db, halt, resume };
}

const BEHIND = "PR not merged: merge refused: Head branch is not up to date with the base branch";

describe("POST /api/runs/:id/resume from the orchestrator (ADR 0055)", () => {
  it("resumes a lot halted because its PR is not up to date", async () => {
    expect(await world(BEHIND).resume()).toBe(200);
  });

  it("refuses a decision halt — the lead's rounds ran out", async () => {
    expect(await world("5 rounds without the lead finding it finished — change it in Project settings → Rounds before calling me").resume()).toBe(403);
  });

  it(`refuses past ${MAX_AUTO_RESUMES} resumes; the operator still may`, async () => {
    const w = world(BEHIND);
    for (let i = 0; i < MAX_AUTO_RESUMES; i++) {
      expect(await w.resume()).toBe(200);
      await new Promise((r) => setTimeout(r, 2)); // one gesture per millisecond
      w.halt();
    }
    expect(await w.resume()).toBe(403);
    expect(await w.resume({})).toBe(200);
  });

  it("resumes with autonomy off when the repo's objective is active; refuses once it is paused", async () => {
    const w = world(BEHIND, false);
    const g = w.db.createGoal({ repoPath: repo, text: "Ship v1", criteria: ["CI green"], budget: DEFAULT_BUDGET })!;
    expect(await w.resume()).toBe(200);
    w.db.setGoalStatus(g.id, ["active"], "paused");
    w.halt();
    expect(await w.resume()).toBe(403);
  });

  it("refuses with autonomy off, and any pane that is not the repo's orchestrator", async () => {
    expect(await world(BEHIND, false).resume()).toBe(403);
    expect(await world(BEHIND).resume({ "x-collie-pane": "worker" })).toBe(403);
  });
});
