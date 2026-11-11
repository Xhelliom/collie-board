import { describe, expect, it } from "bun:test";

import { exitView, handleExitRoute, protocolWatch, readExitState, withHello, type ExitRouteDeps, type ExitState } from "./exit-criteria.ts";

const NONE: ExitState = { harnesses: false, herdr09Frozen: false, protocol: null };
const hc = { engine: "hc" as const, hc: { version: "0.1.20", generation: 1 } };
const old = { engine: "herdr09" as const, hc: null };
const T0 = Date.UTC(2026, 8, 1);

function store(initial: string | null = null) {
  let row = initial;
  return { exitCriteria: () => row, setExitCriteria: (j: string) => void (row = j) };
}

describe("exitView", () => {
  it("holds nothing on a fresh board", () => {
    const v = exitView(NONE, [{ name: "here", engine: null }], T0);
    expect([v.protocol.held, v.machines.held, v.harnesses.held, v.herdr09.held]).toEqual([false, false, false, false]);
  });
  it("criterion 1 holds two months after the generation was first seen", () => {
    const s = { ...NONE, protocol: { generation: 1, version: "0.1.20", since: T0 } };
    expect(exitView(s, [], Date.UTC(2026, 9, 31)).protocol.held).toBe(false);
    expect(exitView(s, [], Date.UTC(2026, 10, 1)).protocol).toMatchObject({ held: true, generation: 1, since: T0, due: Date.UTC(2026, 10, 1) });
  });
  it("criterion 2 counts the machines on hc; an unknown one is not", () => {
    const v = exitView(NONE, [{ name: "here", engine: hc }, { name: "dev", engine: old }, { name: "win", engine: null }], T0);
    expect(v.machines).toMatchObject({ held: false, onHc: 1, total: 3 });
    expect(v.machines.list[2]).toEqual({ name: "win", engine: null });
    expect(exitView(NONE, [{ name: "here", engine: hc }, { name: "dev", engine: hc }], T0).machines.held).toBe(true);
  });
});

describe("withHello / protocolWatch", () => {
  it("a new generation restarts the clock, a new release of the same one does not", () => {
    const first = withHello(NONE, hc.hc, T0)!;
    expect(first.protocol).toEqual({ generation: 1, version: "0.1.20", since: T0 });
    expect(withHello(first, hc.hc, T0 + 5)).toBeNull();
    expect(withHello(first, { version: "0.1.21", generation: 1 }, T0 + 5)!.protocol).toEqual({ generation: 1, version: "0.1.21", since: T0 });
    expect(withHello(first, { version: "0.2.0", generation: 2 }, T0 + 5)!.protocol!.since).toBe(T0 + 5);
    expect(withHello(first, null, T0 + 5)).toBeNull();
  });
  it("writes once per hello seen, and keeps the operator's ticks", () => {
    const db = store(JSON.stringify({ harnesses: true }));
    let writes = 0;
    const set = db.setExitCriteria;
    db.setExitCriteria = (j) => (writes++, set(j));
    const tick = protocolWatch(db, () => hc.hc, () => T0);
    tick();
    tick();
    expect(writes).toBe(1);
    expect(readExitState(db)).toEqual({ harnesses: true, herdr09Frozen: false, protocol: { generation: 1, version: "0.1.20", since: T0 } });
  });
});

describe("handleExitRoute", () => {
  function deps(over: Partial<ExitRouteDeps> = {}) {
    const d: ExitRouteDeps = {
      db: store(),
      machines: () => [{ name: "here", engine: hc }],
      guard: () => null,
      audit: () => {},
      json: (data, status) => Response.json(data, { status: status ?? 200 }),
      text: (body, status) => new Response(body, { status }),
      now: () => T0,
      ...over,
    };
    return d;
  }
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/exit-criteria", { method: "POST", body: JSON.stringify(body), headers });

  it("ticks survive a restart: they are read back from the store", async () => {
    const d = deps();
    const res = await handleExitRoute("/api/exit-criteria", post({ herdr09Frozen: true }), d);
    expect(((await res!.json()) as { herdr09: { held: boolean } }).herdr09.held).toBe(true);
    await handleExitRoute("/api/exit-criteria", post({ harnesses: true }), d);
    const again = await handleExitRoute("/api/exit-criteria", new Request("http://x/"), deps({ db: d.db })); // a new process, the same row
    expect(await again!.json()).toMatchObject({ harnesses: { held: true }, herdr09: { held: true }, machines: { held: true, onHc: 1, total: 1 } });
  });
  it("refuses an agent pane, a bad body, a denied caller; ignores other paths", async () => {
    const d = deps();
    expect((await handleExitRoute("/api/exit-criteria", post({ harnesses: true }, { "x-collie-pane": "t3" }), d))!.status).toBe(403);
    expect((await handleExitRoute("/api/exit-criteria", post({ harnesses: "yes" }), d))!.status).toBe(400);
    expect(readExitState(d.db).harnesses).toBe(false);
    expect((await handleExitRoute("/api/exit-criteria", new Request("http://x/"), deps({ guard: () => new Response("no", { status: 403 }) })))!.status).toBe(403);
    expect(await handleExitRoute("/api/other", new Request("http://x/"), d)).toBeNull();
  });
});
