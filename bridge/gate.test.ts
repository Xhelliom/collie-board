import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";

import { BoardDb } from "./db.ts";
import { gateNote, gatePrompt, gatesWaiting, oneAtATime, parseGate, runGate, spawnGate, summarizeGate } from "./gate.ts";

// The gate commands are this very bun, so the test runs where no `true`, `sh` or `sleep` exists (Windows).
const bun = (code: string) => [process.execPath, "-e", code];
const TRUE = bun("");
const SLEEP = bun("setTimeout(() => {}, 5000)");
const tmp = tmpdir();

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

  it("gateNote is the last non-empty stdout line, capped", () => {
    expect(gateNote("a\nb\n\n")).toBe("b");
    expect(gateNote("  \n")).toBeUndefined();
    expect(gateNote("x".repeat(500))).toHaveLength(200);
  });

  it("gatePrompt names the command and carries the report", () => {
    expect(gatePrompt("make", "boom")).toContain("`make`");
    expect(gatePrompt("make", "boom")).toContain("boom");
  });

  it("runGate: pass, fail with output, missing binary, timeout", async () => {
    expect(await runGate(TRUE, tmp)).toMatchObject({ kind: "pass" });
    expect(await runGate(bun('console.log("tests\\ntests skipped")'), tmp)).toEqual({ kind: "pass", note: "tests skipped" });
    const fail = await runGate(bun('console.error("bad"); process.exit(3)'), tmp);
    expect(fail).toMatchObject({ kind: "fail", exit: 3 });
    expect((fail as { summary: string }).summary).toContain("bad");
    expect((await runGate(["definitely-not-a-binary-xyz"], tmp)).kind).toBe("error");
    expect(await runGate(SLEEP, tmp, 50)).toMatchObject({ kind: "error" });
  });

  // Incident 23/11: a grandchild kept the pipes open, a 30-min gate held the queue for 4 h 16.
  it.skipIf(process.platform === "win32")("a timed-out gate hands back at once and its whole group dies", async () => {
    const pidFile = `${tmp}/gate-grandchild-${process.pid}`;
    const t0 = performance.now();
    const r = await spawnGate(["sh", "-c", `sleep 600 & echo $! > ${pidFile}; wait`], tmp, 200);
    expect(r).toMatchObject({ kind: "error" });
    expect(performance.now() - t0).toBeLessThan(1_200);
    const grandchild = Number(await Bun.file(pidFile).text());
    await Bun.sleep(50);
    expect(() => process.kill(grandchild, 0)).toThrow();
  });

  it("oneAtATime: calls never overlap, and a failing one frees the slot", async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const job = oneAtATime(async (name: string, fail: boolean) => {
      running++;
      peak = Math.max(peak, running);
      await Bun.sleep(10);
      running--;
      order.push(name);
      if (fail) throw new Error(name);
      return name;
    });
    const results = await Promise.allSettled([job("a", false), job("b", true), job("c", false)]);
    expect(peak).toBe(1);
    expect(order).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("runGate is queued: a gate waits out a timed-out one, then runs", async () => {
    const t0 = Date.now();
    const [slow, fast] = await Promise.all([runGate(SLEEP, tmp, 100), runGate(TRUE, tmp)]);
    expect(slow.kind).toBe("error");
    expect(fast).toMatchObject({ kind: "pass" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it("two ready cards: the second waits, listed in gatesWaiting until its turn (audit P5)", async () => {
    // The first card's gate reports whether the second is listed as waiting while it runs.
    const first = runGate(bun('setTimeout(() => {}, 300)'), tmp, undefined, "card-a");
    const second = runGate(TRUE, tmp, undefined, "card-b");
    expect(gatesWaiting.has("card-b")).toBe(true);
    await Bun.sleep(100);
    expect(gatesWaiting.has("card-a")).toBe(false); // running, not waiting
    expect(gatesWaiting.has("card-b")).toBe(true);
    await first;
    await second;
    expect(gatesWaiting.size).toBe(0);
  });

  it("a gate runs at low priority, and its children inherit it", async () => {
    if (process.platform === "win32") return; // getpriority from the child is POSIX; Windows only must not break
    const r = await runGate(bun('console.log(require("node:os").getPriority())'), tmp);
    expect(r).toEqual({ kind: "pass", note: "19" });
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
