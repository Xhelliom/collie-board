import { describe, expect, it } from "bun:test";

import { BoardNotifier } from "./board-notify.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { HELD_EXPIRE_MS, HELD_REMIND_MS, hold, paneHeld, release, sweepHeld, touchHeld } from "./held.ts";
import { NotifyLog } from "./notify-log.ts";
import { RunCoordinator, type RunPorts } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const snap = (panes: Record<string, string>): EngineSnapshot =>
  ({ agents: Object.entries(panes).map(([paneId, status]) => ({ paneId, status })), shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) as unknown as EngineSnapshot;
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Two landed workers in one lot; the lead answers `prompt` from a queue, then `finished`. */
function lot() {
  const db = new BoardDb(":memory:");
  const [a, b] = ["a", "b"].map((title) => {
    const c = db.createCard({ title, repoPath: "/r" });
    db.openSession({ cardId: c.id, paneId: `p-${title}` });
    db.setStatus(c.id, "review", "agent done");
    return c;
  }) as [ReturnType<BoardDb["createCard"]>, ReturnType<BoardDb["createCard"]>];
  const run = db.createRun({ repoPath: "/r", cardIds: [a.id, b.id], foldInCap: 0 });
  const calls: string[] = [];
  const ports = {
    lead: { check: async (i: { title: string }) => (calls.push(`check ${i.title}`), { decision: "finished", reason: "ok" }) },
    prompt: async (pane: string) => void calls.push(`prompt ${pane}`),
    openPr: async (c: { id: string; title: string }) => (calls.push(`pr ${c.title}`), db.recordEvent(c.id, "card.pr_opened", {}), db.recordEvent(c.id, "card.automerge_armed", {}), { ok: true }),
    fileAsDone: (c: { id: string; title: string }) => {
      calls.push(`done ${c.title}`);
      db.closeSession(db.openSessionFor(c.id)!.id, "done");
      db.setStatus(c.id, "done", "manual");
    },
    direct: () => false,
    brief: async (c: { title: string }) => ({ title: c.title, spec: null, acceptance: [], worktree: "/wt", base: "main" }),
    stat: async () => "a.ts | 1 +",
    report: async () => null,
    freeSlots: () => 3,
    reviewing: () => false,
    gateCommand: () => null,
    commits: async () => 1,
    lastReply: async () => "",
  } as unknown as RunPorts;
  const coord = new RunCoordinator(db, ports);
  const tick = async () => {
    for (let i = 0; i < 4; i++) {
      coord.update(snap({ "p-a": "idle", "p-b": "idle" }));
      await flush();
    }
  };
  return { db, a, b, run, calls, tick };
}

describe("« En main » (ADR 0058)", () => {
  it("the lead neither judges, prompts nor files a held card; the rest of the lot goes on and the lot waits", async () => {
    const { db, a, calls, tick } = lot();
    hold(db, a.id);
    await tick();
    expect(calls).toEqual(["check b", "pr b", "done b"]);
    expect(db.listEvents(a.id).some((e) => e.type.startsWith("run."))).toBe(false);
    expect(db.listOpenRuns()).toHaveLength(1);

    // Given back: the lead picks up from the worker's current state, and no round was spent.
    release(db, a.id);
    await tick();
    expect(calls.slice(3)).toEqual(["check a", "pr a", "done a"]);
    expect(db.listEvents(a.id).filter((e) => e.type === "run.decision" && (e.payload as { decision: string }).decision === "prompt")).toEqual([]);
    expect(db.listOpenRuns()).toEqual([]);
  });

  it("only a card with a live worker can be held; the operator writing to its pane takes it", () => {
    const db = new BoardDb(":memory:");
    const idle = db.createCard({ title: "idle", repoPath: "/r" });
    expect(hold(db, idle.id)).toBeNull();
    const c = db.createCard({ title: "c", repoPath: "/r" });
    db.openSession({ cardId: c.id, paneId: "p" });
    touchHeld(db, "shell-pane", 5);
    expect(paneHeld(db, "p")).toBe(false);
    touchHeld(db, "p", 10);
    touchHeld(db, "p", 20);
    expect(db.getCard(c.id)!.held).toEqual({ by: "operator", at: 10, lastTouch: 20 });
    expect(paneHeld(db, "p")).toBe(true);
    expect(db.listEvents(c.id).filter((e) => e.type === "card.held")).toHaveLength(1);
    // Out of the patch allowlist: no body can set or clear it.
    db.patchCard(c.id, { held: null } as never);
    expect(db.getCard(c.id)!.held).not.toBeNull();
  });

  it("1 h without a message reminds once; a message resets the count; 2 h gives it back by itself", () => {
    const db = new BoardDb(":memory:");
    const c = db.createCard({ title: "c", repoPath: "/r" });
    db.openSession({ cardId: c.id, paneId: "p" });
    const reminders = () => db.listEvents(c.id).filter((e) => e.type === "card.held_reminder").length;
    hold(db, c.id, 0);
    sweepHeld(db, HELD_REMIND_MS - 1);
    expect(reminders()).toBe(0);
    sweepHeld(db, HELD_REMIND_MS);
    sweepHeld(db, HELD_REMIND_MS + 5_000);
    expect(reminders()).toBe(1);

    // The operator writes again: the count starts over.
    touchHeld(db, "p", HELD_REMIND_MS + 10_000);
    sweepHeld(db, HELD_EXPIRE_MS);
    expect(reminders()).toBe(1);
    expect(db.getCard(c.id)!.held).not.toBeNull();
    sweepHeld(db, 2 * HELD_REMIND_MS + 10_000);
    expect(reminders()).toBe(2);

    sweepHeld(db, HELD_REMIND_MS + 10_000 + HELD_EXPIRE_MS);
    expect(db.getCard(c.id)!.held).toBeNull();
    expect(db.listEvents(c.id).find((e) => e.type === "card.released")!.payload).toEqual({ why: "expired" });
  });

  it("a held card whose session ended is dropped silently", () => {
    const db = new BoardDb(":memory:");
    const c = db.createCard({ title: "c", repoPath: "/r" });
    const s = db.openSession({ cardId: c.id, paneId: "p" });
    hold(db, c.id, 0);
    db.closeSession(s.id, "done");
    sweepHeld(db, 1);
    expect(db.getCard(c.id)!.held).toBeNull();
  });

  it("the reminder retracts when the operator writes again or gives it back; the expiry is told in the bell", () => {
    const db = new BoardDb(":memory:");
    const c = db.createCard({ title: "c", repoPath: "/r" });
    db.openSession({ cardId: c.id, paneId: "p" });
    const log = new NotifyLog();
    const armed = new Map<string, string>();
    const notifier = new BoardNotifier(db, log, { arm: (k, a) => void armed.set(k, a.subtitle ?? ""), retract: (k) => void armed.delete(k) });
    const key = `held:${c.id}`;

    hold(db, c.id, 0);
    sweepHeld(db, HELD_REMIND_MS);
    notifier.update();
    expect(armed.get(key)).toBe("En main depuis 1 h, rendu au lead dans 1 h");
    touchHeld(db, "p", HELD_REMIND_MS + 1);
    notifier.update();
    expect(armed.has(key)).toBe(false);

    sweepHeld(db, 2 * HELD_REMIND_MS + 1);
    notifier.update();
    expect(armed.has(key)).toBe(true);
    sweepHeld(db, HELD_REMIND_MS + 1 + HELD_EXPIRE_MS);
    notifier.update();
    expect(armed.has(key)).toBe(false);
    expect(log.recent().map((l) => l.subtitle)).toEqual(["En main depuis 2 h sans message — rendu au lead"]);
  });

  it("routes: the operator takes and gives back; an agent pane can do neither, and gets 409 prompting a held card", async () => {
    const db = new BoardDb(":memory:");
    const c = db.createCard({ title: "c", repoPath: "/r" });
    db.openSession({ cardId: c.id, paneId: "p" });
    const ctx = {
      db,
      herdr: {},
      copilot: { busy: () => new Set<string>() },
      engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
      cfg: {},
      audit: { record: () => {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    } as never;
    const call = async (method: string, action: string, headers: Record<string, string> = {}, body?: unknown) => {
      const path = `/api/cards/${c.id}/${action}`;
      const res = await handleBoardRoute(path, new Request(`http://x${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
      return { status: res!.status, body: (await res!.json().catch(() => null)) as { kind?: string; card?: { held: unknown } } | null };
    };
    const agent = { "x-collie-pane": "o1" };

    expect((await call("POST", "hold", agent)).status).toBe(403);
    const taken = await call("POST", "hold");
    expect(taken.status).toBe(200);
    expect(taken.body!.card!.held).toMatchObject({ by: "operator" });

    const refused = await call("POST", "prompt", agent, { text: "go on" });
    expect(refused.status).toBe(409);
    expect(refused.body!.kind).toBe("held");

    expect((await call("DELETE", "hold", agent)).status).toBe(403);
    expect(db.getCard(c.id)!.held).not.toBeNull();
    expect((await call("DELETE", "hold")).body!.card!.held).toBeNull();
  });
});
