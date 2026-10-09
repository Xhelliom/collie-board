import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { gatePrompt, parseGate, runGate, summarizeGate } from "./gate.ts";

describe("gate (ADR 0020)", () => {
  it("parseGate splits on whitespace and refuses blank", () => {
    expect(parseGate("  tools/ovg   gate ")).toEqual(["tools/ovg", "gate"]);
    expect(parseGate("   ")).toBeNull();
    expect(parseGate(null)).toBeNull();
  });

  it("summarizeGate keeps the tail, marked as cut", () => {
    const out = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const s = summarizeGate(out);
    expect(s.startsWith("…\n")).toBe(true);
    expect(s.endsWith("line 99")).toBe(true);
    expect(s.split("\n")).toHaveLength(41);
    expect(summarizeGate("short")).toBe("short");
    expect(summarizeGate("x".repeat(9000)).length).toBeLessThanOrEqual(4_002);
  });

  it("gatePrompt names the command and carries the report", () => {
    expect(gatePrompt("make", "boom")).toContain("`make`");
    expect(gatePrompt("make", "boom")).toContain("boom");
  });

  it("runGate: pass, fail with output, missing binary, timeout", async () => {
    expect(await runGate(["true"], "/tmp")).toEqual({ kind: "pass" });
    const fail = await runGate(["sh", "-c", "echo bad >&2; exit 3"], "/tmp");
    expect(fail).toMatchObject({ kind: "fail", exit: 3 });
    expect((fail as { summary: string }).summary).toContain("bad");
    expect((await runGate(["definitely-not-a-binary-xyz"], "/tmp")).kind).toBe("error");
    expect(await runGate(["sleep", "5"], "/tmp", 50)).toMatchObject({ kind: "error" });
  });

  it("a repo's gate survives hiding and unhiding, and a bare row is pruned", () => {
    const db = new BoardDb(":memory:");
    db.setRepoGate("/r", "make test");
    db.setRepoHidden("/r", true);
    db.setRepoHidden("/r", false);
    expect(db.repoGate("/r")).toBe("make test");
    expect(db.hiddenRepos().has("/r")).toBe(false);
    db.setRepoGate("/r", null);
    expect(db.repoGate("/r")).toBeNull();
    db.setRepoHidden("/h", true);
    expect(db.hiddenRepos().has("/h")).toBe(true);
    db.setRepoHidden("/h", false);
    expect(db.hiddenRepos().size).toBe(0);
  });
});
