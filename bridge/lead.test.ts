import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BILAN_REL_PATH,
  bilanPrompt,
  checkPrompt,
  conflictPrompt,
  toCheckDecision,
  toConflictDecision,
  Lead,
  LEAD_ATTEMPTS,
  LeadSilent,
  parseIssue,
  toTriageDecision,
  triagePrompt,
} from "./lead.ts";

const brief = {
  title: "Add the lead",
  spec: "A second role beside the copilot.",
  acceptance: ["prompts are pure", "no path to push"],
  worktree: "/wt/card",
  base: "main",
  outPath: ".board/out/x.json",
};

describe("lead prompts", () => {
  it("check reads the checkout, never acts, and names the answer file", () => {
    const p = checkPrompt({ ...brief, statSummary: " a.ts | 3 +++" });
    expect(p).toContain("git -C /wt/card diff main...HEAD");
    expect(p).toContain("- no path to push");
    expect(p).toContain(" a.ts | 3 +++");
    expect(p).toContain("do not commit");
    expect(p).toContain(".board/out/x.json");
    expect(p).toContain('"decision": "finished | prompt"');
  });

  it("check carries the worker's bilan and judges an empty diff with it", () => {
    const p = checkPrompt({ ...brief, statSummary: "(no changes)", workerReport: "Déjà livré : commit abc123 sur main." });
    expect(p).toContain("Déjà livré : commit abc123 sur main.");
    expect(p).toContain("verify");
    expect(p).toContain("git -C /wt/card log main");
    expect(checkPrompt({ ...brief, statSummary: "" })).not.toContain("worker's own bilan");
  });

  it("the worker is told where to write its bilan", () => {
    expect(bilanPrompt()).toContain(BILAN_REL_PATH);
  });

  it("the bilan's outcome line is asked for and read, tolerating its absence", () => {
    expect(bilanPrompt()).toContain("Issue : déjà présent");
    expect(parseIssue("Issue : codé\nrest")).toBe("coded");
    expect(parseIssue("# Bilan\n**Issue :** déjà présent — abc123")).toBe("present");
    expect(parseIssue("issue: Partiel")).toBe("partial");
    expect(parseIssue("Issue : rien fait")).toBe("none");
    expect(parseIssue("Outcome: already there")).toBe("present");
    expect(parseIssue("Did the thing.\nAll green.")).toBeNull();
    expect(parseIssue("Issue : bof")).toBeNull();
  });

  it("triage lists follow-ups by index, with the review's verdict and notes", () => {
    const p = triagePrompt({
      ...brief,
      verdict: "drift",
      notes: "went another way",
      followUps: [{ title: "Doc it" }, { title: "Test it", spec: "cover the parser" }],
    });
    expect(p).toContain("The review's verdict: drift");
    expect(p).toContain("went another way");
    expect(p).toContain("0. Doc it");
    expect(p).toContain("1. Test it — cover the parser");
    expect(p).toContain("keep | fold | drop");
  });

  it("conflict re-check names the conflicting files and can halt", () => {
    const p = conflictPrompt({ ...brief, conflicts: ["bridge/x.ts"] });
    expect(p).toContain("- bridge/x.ts");
    expect(p).toContain("resolved | prompt | halt");
  });

  it("check on an explore card judges the conclusion, not the diff", () => {
    const code = checkPrompt({ ...brief, statSummary: "" });
    const explore = checkPrompt({ ...brief, statSummary: "", category: "explore" });
    expect(code).toContain("every acceptance criterion holds in the code");
    expect(explore).not.toContain("every acceptance criterion holds in the code");
    expect(explore).toContain("the conclusion answers the card's question");
    expect(explore).toContain("cards it proposed are defensible");
    expect(checkPrompt({ ...brief, statSummary: "", category: "bug" })).toBe(code);
  });

  it("check on a business card judges the document, and never sends it back for missing code", () => {
    const p = checkPrompt({ ...brief, statSummary: " docs/offre.md | 40 +", category: "business" });
    expect(p).not.toContain("every acceptance criterion holds in the code");
    expect(p).toContain("never send it back for missing code");
  });

  it("is pure — same input, same prompt", () => {
    expect(checkPrompt({ ...brief, statSummary: "" })).toBe(checkPrompt({ ...brief, statSummary: "" }));
  });
});

describe("lead answers", () => {
  it("parses a check", () => {
    expect(toCheckDecision({ decision: "finished", reason: "all criteria hold" })).toEqual({
      decision: "finished",
      reason: "all criteria hold",
    });
    expect(toCheckDecision({ decision: "prompt", prompt: "commit", reason: "uncommitted" })).toEqual({
      decision: "prompt",
      prompt: "commit",
      reason: "uncommitted",
    });
  });

  it("invalid JSON is an error, never a decision", () => {
    for (const bad of [null, "finished", [], 3, {}]) {
      expect(() => toCheckDecision(bad)).toThrow();
      expect(() => toConflictDecision(bad)).toThrow();
      expect(() => toTriageDecision(bad, 0)).toThrow();
    }
    expect(() => toCheckDecision({ decision: "merge", reason: "x" })).toThrow();
    expect(() => toCheckDecision({ decision: "prompt", reason: "x" })).toThrow(); // no message
    expect(() => toConflictDecision({ decision: "push", reason: "x" })).toThrow();
  });

  it("every decision carries a non-empty reason", () => {
    expect(() => toCheckDecision({ decision: "finished" })).toThrow();
    expect(() => toCheckDecision({ decision: "finished", reason: "  " })).toThrow();
    expect(() => toConflictDecision({ decision: "halt", reason: "" })).toThrow();
    expect(() => toTriageDecision({ verdict: { accept: true }, followUps: [] }, 0)).toThrow();
    expect(() =>
      toTriageDecision(
        { verdict: { accept: true, reason: "ok" }, followUps: [{ index: 0, action: "drop", reason: "" }] },
        1,
      ),
    ).toThrow();
  });

  it("triage decides every follow-up exactly once", () => {
    const ok = {
      verdict: { accept: true, reason: "drift is a better path" },
      followUps: [
        { index: 1, action: "fold", reason: "belongs here" },
        { index: 0, action: "drop", reason: "already done" },
      ],
    };
    expect(toTriageDecision(ok, 2).followUps.map((f) => f.index)).toEqual([0, 1]);
    expect(() => toTriageDecision(ok, 3)).toThrow(); // one left undecided
    expect(() => toTriageDecision(ok, 1)).toThrow(); // index 1 out of range
    const twice = { ...ok, followUps: [ok.followUps[1], ok.followUps[1]] };
    expect(() => toTriageDecision(twice, 2)).toThrow();
    const unknown = { ...ok, followUps: [{ index: 0, action: "merge", reason: "x" }] };
    expect(() => toTriageDecision(unknown, 1)).toThrow();
  });
});

describe("the lead has no path to act", () => {
  it("imports nothing but the copilot's plumbing", async () => {
    const src = await Bun.file(new URL("./lead.ts", import.meta.url)).text();
    const imports = [...src.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./copilot.ts"]);
  });
});

describe("a malformed answer is asked again", () => {
  /** A Lead whose `ask` answers from a queue and records the prompts it was given. */
  function lead(answers: unknown[]) {
    const l = new Lead(...([null, null, "/tmp/unused", () => null] as unknown as ConstructorParameters<typeof Lead>));
    const prompts: string[] = [];
    (l as unknown as { request: (b: (o: string) => string) => Promise<unknown> }).request = async (b) => (prompts.push(b("out.json")), { answer: answers.shift() });
    return { l, prompts };
  }
  const input = { ...brief, verdict: "ok", notes: null, followUps: [] };
  const valid = { verdict: { accept: true, reason: "fine" }, followUps: [] };

  it("a triage without a reason is asked again with the error, and a valid second answer goes on", async () => {
    const { l, prompts } = lead([{ verdict: { accept: true }, followUps: [] }, valid]);
    expect(await l.triage(input)).toEqual(valid);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("REJECTED");
    expect(prompts[1]).toContain('REJECTED: missing or empty "reason" in the verdict');
  });

  it(`after ${LEAD_ATTEMPTS} malformed answers it throws, saying what is missing`, async () => {
    const { l, prompts } = lead(Array.from({ length: LEAD_ATTEMPTS }, () => ({ verdict: { accept: true }, followUps: [] })));
    await expect(l.triage(input)).rejects.toThrow(`the lead's triage answer was malformed ${LEAD_ATTEMPTS} times in a row — missing or empty "reason" in the verdict`);
    expect(prompts).toHaveLength(LEAD_ATTEMPTS);
  });
});

describe("the lead is silent only when a typed request ran out its deadline", () => {
  /** A real Lead over a fake herd whose lead agent writes `reply(n)` as its answer file — or nothing. */
  function leadWith(reply: (n: number) => string | null, failPrompt = false) {
    const dir = mkdtempSync(join(tmpdir(), "lead-test-"));
    const snap = { agents: [{ paneId: "wL:p1", cwd: dir, status: "idle" }], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };
    let n = 0;
    const herdr = {
      async getAgent() {
        return { agent: "claude", interactive_ready: true, agent_status: "working" };
      },
      async promptAgent(opts: { text: string }) {
        if (failPrompt) throw new Error("herdr agent.prompt: agent_blocked");
        const rel = readFileSync(join(dir, /Read (\S+\.md)/.exec(opts.text)![1]!), "utf8").match(/\.board\/out\/\w+\.json/)![0];
        const body = reply(++n);
        if (body !== null) writeFileSync(join(dir, rel), body);
      },
      async sendPaneKeys() {},
    };
    const cfg = { boardAgentKind: "claude", boardCopilotKind: "" };
    return new Lead(...([herdr, cfg, dir, () => snap, {}, { timeoutMs: 120, pollMs: 10 }] as unknown as ConstructorParameters<typeof Lead>));
  }
  const input = { ...brief, statSummary: " a.ts | 1 +" };

  it("an answer with a raw Windows path is read — the Dell's lead answered, and was called silent", async () => {
    const l = leadWith(() => String.raw`{"decision": "finished", "reason": "C:\Users\steph\wt\card holds the fix"}`);
    expect(await l.check(input)).toEqual({ decision: "finished", reason: String.raw`C:\Users\steph\wt\card holds the fix` });
  });

  it("an answer file that is not JSON is asked again with the parse error, never called silence", async () => {
    const l = leadWith((n) => (n === 1 ? "finished, all good" : '{"decision": "finished", "reason": "ok"}'));
    expect(await l.check(input)).toEqual({ decision: "finished", reason: "ok" });
  });

  it("a request that never reached the pane says why, not « the lead is not answering »", async () => {
    const err = await leadWith(() => null, true).check(input).catch((e: Error) => e);
    expect(err).not.toBeInstanceOf(LeadSilent);
    expect((err as Error).message).toContain("the lead was never asked");
    expect((err as Error).message).toContain("agent_blocked");
  });

  it("a typed request with no answer by the deadline is LeadSilent, naming the pane", async () => {
    const err = await leadWith(() => null).check(input).catch((e: Error) => e);
    expect(err).toBeInstanceOf(LeadSilent);
    expect((err as LeadSilent).paneId).toBe("wL:p1");
  });
});

describe("the lead's folder is trusted before Claude starts in it", () => {
  it("marks hasTrustDialogAccepted on its working dir before agent.start — a fresh install stalled on « trust? »", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lead-trust-"));
    const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };
    const trustFile = join(process.env.CLAUDE_CONFIG_DIR!, ".claude.json");
    let trustedAtStart: unknown = null;
    const herdr = {
      async createWorkspace() {
        return { paneId: "wL:p1", workspaceId: "wL", tabId: "wL:t1", cwd: dir };
      },
      async startAgent() {
        const cfg = JSON.parse(readFileSync(trustFile, "utf8")) as { projects: Record<string, { hasTrustDialogAccepted?: boolean }> };
        trustedAtStart = cfg.projects[dir]?.hasTrustDialogAccepted;
      },
      async getAgent() {
        return { agent: "claude", interactive_ready: true, agent_status: "working" };
      },
      async promptAgent() {},
      async sendPaneKeys() {},
    };
    const cfg = { boardAgentKind: "claude", boardCopilotKind: "" };
    const l = new Lead(...([herdr, cfg, dir, () => snap, {}, { timeoutMs: 30, pollMs: 10 }] as unknown as ConstructorParameters<typeof Lead>));
    await l.check({ ...brief, statSummary: " a.ts | 1 +" }).catch(() => {});
    expect(trustedAtStart).toBe(true);
  });
});

describe("a lead adopted at startup is known before its first request", () => {
  it("observe() adopts the agent already running in its directory, and forgets it once gone", () => {
    // Live 07/11: « adopted the existing agent in w8B:p1 » came only with the next request — until
    // then the lead's paneId was null, and every turn of it paged the operator (index.ts).
    const dir = mkdtempSync(join(tmpdir(), "lead-adopt-"));
    const snap = (agents: { paneId: string; cwd: string }[], bridge = "connected") => ({ agents, shellPanes: [], workspaces: [], tabs: [], bridge }) as never;
    const l = new Lead(...([null, {}, dir, () => snap([]), {}] as unknown as ConstructorParameters<typeof Lead>));
    expect(l.paneId).toBeNull();
    l.observe(snap([{ paneId: "wW:p1", cwd: "/elsewhere" }, { paneId: "w8B:p1", cwd: dir }]));
    expect(l.paneId).toBe("w8B:p1");
    l.observe(snap([], "disconnected"));
    expect(l.paneId).toBe("w8B:p1");
    l.observe(snap([]));
    expect(l.paneId).toBeNull();
  });
});
