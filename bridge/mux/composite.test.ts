import { describe, expect, test } from "bun:test";
import { CompositeMux, ownerOf, STALE_GRACE_MS } from "./composite.ts";
import type { Mux, WirePane, WireSnapshot } from "./mux.ts";

const pane = (pane_id: string, workspace_id: string): WirePane => ({
  pane_id,
  terminal_id: pane_id,
  workspace_id,
  tab_id: `${workspace_id}:t1`,
  focused: false,
  cwd: "/r",
  agent: "claude",
  agent_status: "idle",
  revision: 0,
});

const snap = (panes: WirePane[]): WireSnapshot => ({ version: "v", protocol: 1, workspaces: [], tabs: [], panes });

/** A fake engine: answers its snapshot (or fails while `down`), records every call it gets. */
function fake(panes: WirePane[]) {
  const calls: string[] = [];
  let down = false;
  const subs: Array<{ subscriptions: Array<{ type: string; pane_id?: string }>; onUp(): void; onDown(r: string): void; closed: boolean }> = [];
  const rec = (name: string) => async (...args: unknown[]) => {
    calls.push(`${name} ${JSON.stringify(args[0])}`);
    return undefined;
  };
  const mux = new Proxy({} as Mux, {
    get: (_t, k: string) => {
      if (k === "sessionSnapshot") return async () => (down ? Promise.reject(new Error("ECONNREFUSED")) : snap(panes));
      if (k === "ping") return async () => !down;
      if (k === "subscribeEvents")
        return (o: (typeof subs)[number]) => {
          const s = { ...o, closed: false };
          subs.push(s);
          return { close: () => (s.closed = true) };
        };
      if (k === "then") return undefined;
      return rec(k);
    },
  });
  return { mux, calls, subs, setDown: (d: boolean) => (down = d) };
}

describe("ownerOf", () => {
  test("hc's addresses and its one space are hc; every herdr 0.9 id stays herdr 0.9's", () => {
    expect(ownerOf("t3")).toBe("hc");
    expect(ownerOf("t12")).toBe("hc");
    expect(ownerOf("hc")).toBe("hc");
    expect(ownerOf("w0000000000000:p1")).toBe("herdr09");
    expect(ownerOf("w6:t1")).toBe("herdr09");
    expect(ownerOf("w6")).toBe("herdr09");
  });
});

describe("CompositeMux", () => {
  const setup = (launch: "herdr09" | "hc" = "herdr09") => {
    const h = fake([pane("w1:p1", "w1")]);
    const c = fake([pane("t3", "hc")]);
    let now = 0;
    const mux = new CompositeMux({ herdr09: h.mux, hc: c.mux }, launch, () => now);
    return { h, c, mux, tick: (ms: number) => (now += ms) };
  };

  test("merges both herds, each pane stamped with its engine, ids untouched", async () => {
    const { mux } = setup();
    const s = await mux.sessionSnapshot();
    expect(s.panes.map((p) => [p.pane_id, p.engine])).toEqual([
      ["w1:p1", "herdr09"],
      ["t3", "hc"],
    ]);
  });

  test("an absent engine does not empty the other", async () => {
    const { mux, c } = setup();
    c.setDown(true);
    expect((await mux.sessionSnapshot()).panes.map((p) => p.pane_id)).toEqual(["w1:p1"]);
  });

  test("a blip keeps the failing engine's last panes for the grace, then drops them", async () => {
    const { mux, h, tick } = setup();
    await mux.sessionSnapshot();
    h.setDown(true);
    tick(STALE_GRACE_MS);
    expect((await mux.sessionSnapshot()).panes.map((p) => p.pane_id)).toEqual(["w1:p1", "t3"]);
    tick(1);
    expect((await mux.sessionSnapshot()).panes.map((p) => p.pane_id)).toEqual(["t3"]);
  });

  test("only both engines down rejects (= disconnected)", async () => {
    const { mux, h, c } = setup();
    h.setDown(true);
    c.setDown(true);
    await expect(mux.sessionSnapshot()).rejects.toThrow("ECONNREFUSED");
    expect(await mux.ping()).toBe(false);
  });

  test("every action goes to the pane's owner", async () => {
    const { mux, h, c } = setup();
    await mux.sendPaneKeys("t3", ["Enter"]);
    await mux.sendPaneText("w1:p1", "hi");
    await mux.closePane("t3");
    await mux.promptAgent({ target: "w1:p1", text: "go" });
    await mux.removeWorktree({ workspaceId: "w1" });
    expect(h.calls.map((x) => x.split(" ")[0])).toEqual(["sendPaneText", "promptAgent", "removeWorktree"]);
    expect(c.calls.map((x) => x.split(" ")[0])).toEqual(["sendPaneKeys", "closePane"]);
  });

  test("a launch goes to the configured engine", async () => {
    const { mux, h, c } = setup("hc");
    await mux.createWorktree({ cwd: "/r", branch: "b" });
    await mux.createWorkspace({ cwd: "/r" });
    expect(c.calls.map((x) => x.split(" ")[0])).toEqual(["createWorktree", "createWorkspace"]);
    expect(h.calls).toEqual([]);
  });

  test("an action for an engine the bridge lacks rejects instead of landing elsewhere", async () => {
    const h = fake([]);
    const mux = new CompositeMux({ herdr09: h.mux }, "herdr09");
    await expect(mux.sendPaneKeys("t3", ["Enter"])).rejects.toThrow("not supported");
    expect(h.calls).toEqual([]);
  });

  test("events: each engine gets its own panes; an absent engine never takes the other's stream down", () => {
    const { mux, h, c } = setup();
    const seen: string[] = [];
    mux.subscribeEvents({
      subscriptions: [{ type: "pane.created" }, { type: "s", pane_id: "w1:p1" }, { type: "s", pane_id: "t3" }],
      onUp: () => seen.push("up"),
      onEvent: () => {},
      onDown: (r) => seen.push(`down ${r}`),
    });
    expect(h.subs[0]!.subscriptions.map((s) => s.pane_id ?? s.type)).toEqual(["pane.created", "w1:p1"]);
    expect(c.subs[0]!.subscriptions.map((s) => s.pane_id ?? s.type)).toEqual(["pane.created", "t3"]);
    h.subs[0]!.onUp();
    c.subs[0]!.onDown("ENOENT"); // hc never came up: ignored
    expect(seen).toEqual(["up"]);
    h.subs[0]!.onDown("closed"); // herdr 0.9 was up: the whole stream is down, once
    expect(seen).toEqual(["up", "down herdr09: closed"]);
  });

  test("events: down when no engine ever came up", () => {
    const { mux, h, c } = setup();
    const seen: string[] = [];
    mux.subscribeEvents({ subscriptions: [], onUp: () => {}, onEvent: () => {}, onDown: (r) => seen.push(r) });
    h.subs[0]!.onDown("a");
    expect(seen).toEqual([]);
    c.subs[0]!.onDown("b");
    expect(seen).toEqual(["hc: b"]);
  });
});
