// herdr-core engine, read side. Fixtures are lines measured on hc 0.1.18 (HERDR_CORE_API.md, and a
// live probe on 2026-11-06), trimmed to the fields the engine reads. The transport is injected, so
// nothing here dials a socket.
import { describe, expect, it } from "bun:test";

import type { DialHandlers, SockHandle } from "../dial.ts";
import { MuxUnsupported, type Mux } from "./mux.ts";
import { decodeHcLine, Hc, hcAgent, hcSnapshot, hcStatus, type HcTerminal } from "./hc.ts";

const shell: HcTerminal = {
  address: "t1",
  argv: ["/bin/zsh"],
  cwd: "/home/u",
  state: "live",
  name: null,
  foreground: { argv: ["/bin/zsh"], cwd: "/home/u", name: "zsh", pid: 34291 },
  status: null,
  turn: 0,
};
const claude: HcTerminal = {
  address: "t3",
  argv: ["claude"],
  cwd: "/wt",
  state: "live",
  name: "probe2",
  status: { app: "claude-code", kind: "permission", msg: "approve Bash: touch x.txt", state: "blocked" },
  turn: 2,
};
const finished: HcTerminal = { ...shell, address: "t12", state: "finished" };

describe("hc status mapping (OSC 7501 → ours)", () => {
  it("keeps the four states we share, flags error as needing the human, the rest unknown", () => {
    expect(["idle", "working", "blocked", "done"].map(hcStatus)).toEqual(["idle", "working", "blocked", "done"]);
    expect(hcStatus("error")).toBe("blocked");
    expect(hcStatus(undefined)).toBe("unknown");
    expect(hcStatus("weird")).toBe("unknown");
  });

  it("names the agent from the app that reports, never from argv", () => {
    expect(hcAgent(claude)).toBe("claude");
    expect(hcAgent(shell)).toBeNull();
    expect(hcAgent({ ...shell, status: { state: "idle", app: "codex" } })).toBe("codex");
  });

  it("snapshots live terminals into one synthetic space, pane id = terminal address", () => {
    const snap = hcSnapshot([shell, claude, finished]);
    expect(snap.workspaces.map((w) => w.workspace_id)).toEqual(["hc"]);
    expect(snap.tabs.map((t) => t.tab_id)).toEqual(["hc"]);
    expect(snap.panes.map((p) => [p.pane_id, p.agent, p.agent_status, p.label])).toEqual([
      ["t1", null, "unknown", null],
      ["t3", "claude", "blocked", "probe2"],
    ]);
    expect(snap.panes[0]!.foreground_cwd).toBe("/home/u");
    expect(snap.workspaces[0]!.pane_count).toBe(2);
  });
});

describe("hc JSON-RPC lines", () => {
  it("decodes a reply, an error, an event and a heartbeat", () => {
    expect(decodeHcLine('{"id":10,"jsonrpc":"2.0","result":{"hidden_finished":0,"terminals":[]}}')).toEqual({
      kind: "reply",
      id: 10,
      result: { hidden_finished: 0, terminals: [] },
    });
    expect(
      decodeHcLine('{"error":{"code":-32000,"data":{"hint":"see `hc ls --all`","kind":"not_found"},"message":"no terminal \\"nope\\""},"id":12,"jsonrpc":"2.0"}'),
    ).toEqual({ kind: "error", id: 12, message: 'not_found: no terminal "nope"' });
    expect(
      decodeHcLine('{"jsonrpc":"2.0","method":"event","params":{"data":{"exit_code":0,"reason":"exited","signal":null},"seq":6,"terminal":"t13","type":"finished"}}'),
    ).toEqual({ kind: "event", type: "finished", data: { exit_code: 0, reason: "exited", signal: null } });
    expect(decodeHcLine('{"jsonrpc":"2.0","method":"heartbeat","params":{}}')).toEqual({ kind: "notice", method: "heartbeat" });
  });

  it("throws on a protocol violation", () => {
    expect(() => decodeHcLine("not json")).toThrow(/bad line/);
    expect(() => decodeHcLine('{"jsonrpc":"2.0"}')).toThrow(/unexpected line/);
  });
});

/** A fake core: answers each written request from `answer`, in chunks the way a socket would. */
function fakeDial(answer: (req: { id: number; method: string; params: Record<string, unknown> }) => string[]) {
  const written: Array<{ method: string; params: Record<string, unknown> }> = [];
  const dial = (h: DialHandlers): Promise<SockHandle> => {
    const s: SockHandle = {
      write(data) {
        const req = JSON.parse(data) as { id: number; method: string; params: Record<string, unknown> };
        written.push(req);
        queueMicrotask(() => {
          for (const line of answer(req)) h.data?.(s, new TextEncoder().encode(line.replaceAll("$ID", String(req.id)) + "\n"));
        });
      },
      flush() {},
      end() {
        queueMicrotask(() => h.close?.(s));
      },
    };
    queueMicrotask(() => h.open?.(s));
    return Promise.resolve(s);
  };
  return { dial, written };
}

describe("Hc engine over an injected transport", () => {
  it("reads the herd with terminal.list and maps it", async () => {
    const { dial, written } = fakeDial(() => [`{"id":$ID,"jsonrpc":"2.0","result":{"terminals":${JSON.stringify([claude])}}}`]);
    const snap = await new Hc("/unused", "auto", dial).sessionSnapshot();
    expect(written[0]!.method).toBe("terminal.list");
    expect(snap.panes[0]!.agent_status).toBe("blocked");
  });

  it("reads output: visible = screen alone, truncated = not complete", async () => {
    const { dial, written } = fakeDial(() => ['{"id":$ID,"jsonrpc":"2.0","result":{"complete":false,"how":"history","text":"bonjour"}}']);
    const hc = new Hc("/unused", "auto", dial);
    expect(await hc.readPane("t3", "recent", 200)).toEqual({ pane_id: "t3", text: "bonjour", truncated: true, revision: 0 });
    await hc.readPane("t3", "visible", 200);
    expect(written.map((w) => w.params.lines)).toEqual([200, 0]);
  });

  it("rejects with hc's own error, and ping says false on it", async () => {
    const { dial } = fakeDial(() => ['{"error":{"code":-32000,"data":{"kind":"not_found"},"message":"no terminal"},"id":$ID,"jsonrpc":"2.0"}']);
    const hc = new Hc("/unused", "auto", dial);
    await expect(hc.getPane("nope")).rejects.toThrow("hc terminal.get: not_found: no terminal");
    expect(await hc.ping()).toBe(false);
  });

  it("subscribes: the snapshot reply is the ack, events poke, heartbeats do not", async () => {
    const { dial } = fakeDial(() => [
      '{"id":$ID,"jsonrpc":"2.0","result":{"channel":null,"seq":3,"terminals":[]}}',
      '{"jsonrpc":"2.0","method":"event","params":{"data":{"app":"claude-code","state":"working"},"seq":4,"terminal":"t3","type":"status"}}',
      '{"jsonrpc":"2.0","method":"event","params":{"seq":5,"type":"heartbeat"}}',
    ]);
    const seen: string[] = [];
    let down = "";
    const sub = new Hc("/unused", "auto", dial).subscribeEvents({
      subscriptions: [{ type: "pane.created" }],
      onUp: () => seen.push("up"),
      onEvent: (e) => seen.push(e),
      onDown: (r) => (down = r),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["up", "status"]);
    sub.close();
    expect(down).toBe("closed");
  });

  it("refuses every write with MuxUnsupported, without touching the socket", async () => {
    const { dial, written } = fakeDial(() => []);
    const hc: Mux = new Hc("/unused", "auto", dial);
    const writes = [
      hc.sendPaneText("t3", "hi"),
      hc.sendPaneKeys("t3", ["Enter"]),
      hc.startAgent({ paneId: "t3", kind: "claude", name: "x" }),
      hc.promptAgent({ target: "t3", text: "hi" }),
      hc.createWorktree({ cwd: "/r", branch: "b" }),
      hc.createTab("hc"),
      hc.closePane("t3"),
    ];
    for (const w of writes) await expect(w).rejects.toBeInstanceOf(MuxUnsupported);
    expect(written).toEqual([]);
  });
});
