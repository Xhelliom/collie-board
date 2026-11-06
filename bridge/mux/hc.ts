import type { AgentStatus } from "../types.ts";
import { dialHerdr, type DialHandlers, type DialMode, type SockHandle } from "../dial.ts";
import {
  MuxUnsupported,
  type CreatedShell,
  type CreatedWorktree,
  type Mux,
  type PaneRead,
  type ReadSource,
  type WireAgent,
  type WirePane,
  type WireSnapshot,
  type WireTab,
  type WireWorkspace,
} from "./mux.ts";
import { DEFAULT_TIMEOUT_MS } from "./herdr09.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The herdr-core (`hc`) engine behind `Mux` — READ ONLY (ADR 0052 phase 2). THE ONLY FILE that knows
// hc's method names and wire shapes; the measured contract is HERDR_CORE_API.md.
//
// - JSON-RPC 2.0, one line per message, on the core's socket. The connection may stay open, but one
//   request per connection is still valid — so a call opens, asks, reads its reply, closes.
// - A terminal is our pane: its address (`t3`) is the pane id, which is also what `HC_TERMINAL_ID`
//   carries in the agent's environment — so provenance (ADR 0010) matches the snapshot.
// - hc has no workspace and no tab: the snapshot has ONE synthetic space holding every terminal.
// - The status is the program's own (OSC 7501), never read off the screen.
// - Every write rejects with MuxUnsupported until phase 3.
// ─────────────────────────────────────────────────────────────────────────────

/** The one space (and tab) every hc terminal is shown in. */
export const HC_SPACE = "hc";

/** The transport: dial the core and hand back a socket. Injected so the Windows named pipe (and tests) plug in. */
export type HcDial = (handlers: DialHandlers) => Promise<SockHandle>;

/** The part of hc's `Terminal` (`hc schema`) this engine reads. */
export interface HcTerminal {
  address: string;
  argv: string[];
  cwd: string;
  state: string;
  name?: string | null;
  labels?: Record<string, string>;
  turn?: number;
  foreground?: { pid: number; name: string; argv: string[]; cwd: string } | null;
  status?: { state: string; app?: string; kind?: string | null; msg?: string } | null;
}

/** OSC 7501 state → ours. `error` needs the human as much as a question does. */
export function hcStatus(state: string | undefined): AgentStatus {
  switch (state) {
    case "idle":
    case "working":
    case "blocked":
    case "done":
      return state;
    case "error":
      return "blocked";
    default:
      return "unknown";
  }
}

/** The app a terminal reports, under the agent name the rest of the bridge knows (adapters, transcripts). */
const APP_AGENT: Record<string, string> = { "claude-code": "claude" };

/** The agent in a terminal, or null for a plain program (it reports no status — hc never guesses). */
export function hcAgent(t: HcTerminal): string | null {
  const app = t.status?.app;
  return app ? (APP_AGENT[app] ?? app) : null;
}

export function toWirePane(t: HcTerminal): WirePane {
  return {
    pane_id: t.address,
    terminal_id: t.address,
    workspace_id: HC_SPACE,
    tab_id: HC_SPACE,
    focused: false,
    cwd: t.cwd,
    ...(t.foreground ? { foreground_cwd: t.foreground.cwd } : {}),
    agent: hcAgent(t),
    agent_status: hcStatus(t.status?.state),
    label: t.name ?? null,
    revision: t.turn ?? 0,
  };
}

export function hcSnapshot(terminals: HcTerminal[], version = "hc"): WireSnapshot {
  const panes = terminals.filter((t) => t.state === "live").map(toWirePane);
  const workspace: WireWorkspace = {
    workspace_id: HC_SPACE,
    number: 1,
    label: HC_SPACE,
    focused: false,
    pane_count: panes.length,
    tab_count: 1,
    active_tab_id: HC_SPACE,
    agent_status: "unknown",
  };
  const tab: WireTab = {
    tab_id: HC_SPACE,
    workspace_id: HC_SPACE,
    number: 1,
    label: HC_SPACE,
    focused: false,
    pane_count: panes.length,
    agent_status: "unknown",
  };
  return { version, protocol: 0, workspaces: [workspace], tabs: [tab], panes };
}

/** One line off the socket: a reply, an error reply, an `event` notification, or another notice. */
export type HcLine =
  | { kind: "reply"; id: unknown; result: unknown }
  | { kind: "error"; id: unknown; message: string }
  | { kind: "event"; type: string; data: unknown }
  | { kind: "notice"; method: string };

/** Decode one line. Throws only on a protocol violation (bad JSON, unknown shape). */
export function decodeHcLine(line: string): HcLine {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`hc: bad line: ${(e as Error).message}`);
  }
  if (msg !== null && typeof msg === "object") {
    if (msg.error && typeof msg.error === "object") {
      const err = msg.error as { message?: string; data?: { kind?: string } };
      const kind = err.data?.kind;
      return { kind: "error", id: msg.id, message: `${kind ? `${kind}: ` : ""}${err.message ?? "error"}` };
    }
    if ("result" in msg) return { kind: "reply", id: msg.id, result: msg.result };
    if (msg.method === "event" && msg.params && typeof msg.params === "object") {
      const p = msg.params as { type?: unknown; data?: unknown };
      if (typeof p.type === "string") return { kind: "event", type: p.type, data: p.data };
    }
    if (typeof msg.method === "string") return { kind: "notice", method: msg.method };
  }
  throw new Error(`hc: unexpected line: ${line}`);
}

let seq = 0;

export class Hc implements Mux {
  private readonly dial: HcDial;

  constructor(socketPath: string, dialMode: DialMode = "auto", dial?: HcDial, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.dial = dial ?? ((h) => dialHerdr(socketPath, h, dialMode));
  }

  /**
   * Open a connection, send one request, feed every line that answers it (or is a notification) to
   * `on`; `onEnd` fires exactly once, whatever ends it. Returns the ender.
   */
  private open(method: string, params: Record<string, unknown>, on: (m: HcLine, end: (reason: string) => void) => void, onEnd: (reason: string) => void): (reason: string) => void {
    const id = ++seq;
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let sock: SockHandle | null = null;
    let cancel: (() => void) | null = null;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      try {
        if (sock) sock.end();
        else cancel?.();
      } catch {
        /* ignore */
      }
      onEnd(reason);
    };
    this.dial({
      onDial: (c) => (cancel = c),
      open: (s) => (sock = s),
      data: (s, chunk) => {
        sock = s;
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while (!ended && (nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m: HcLine;
          try {
            m = decodeHcLine(line);
          } catch (e) {
            end((e as Error).message);
            return;
          }
          if ((m.kind === "reply" || m.kind === "error") && m.id !== id) continue;
          on(m, end);
        }
      },
      error: (_s, err) => end(err.message || "socket error"),
      close: () => end("connection closed"),
    })
      .then((s) => {
        if (ended) {
          s.end();
          return;
        }
        sock = s;
        s.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        s.flush();
      })
      .catch((e: Error) => end(e.message || "connect failed"));
    return end;
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const end = this.open(
        method,
        params,
        (m, end) => {
          if (m.kind === "reply") {
            settled = true;
            resolve(m.result as T);
            end("done");
          } else if (m.kind === "error") end(m.message);
        },
        (reason) => {
          clearTimeout(timer);
          if (!settled) reject(new Error(`hc ${method}: ${reason}`));
        },
      );
      const timer = setTimeout(() => end(`timed out after ${this.timeoutMs}ms`), this.timeoutMs);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("hello");
      return true;
    } catch {
      return false;
    }
  }

  async sessionSnapshot(): Promise<WireSnapshot> {
    const r = await this.request<{ terminals: HcTerminal[] }>("terminal.list");
    return hcSnapshot(r.terminals);
  }

  async listWorkspaces(): Promise<WireWorkspace[]> {
    return (await this.sessionSnapshot()).workspaces;
  }

  async listTabs(): Promise<WireTab[]> {
    return (await this.sessionSnapshot()).tabs;
  }

  async listPanes(): Promise<WirePane[]> {
    return (await this.sessionSnapshot()).panes;
  }

  /**
   * hc's `events.subscribe`: a snapshot reply (= the ack), then `event` notifications. Every terminal,
   * whatever `subscriptions` asks — herdr 0.9's per-pane types have no hc meaning, and an event only
   * pokes the engine's re-poll (EventPoker), it is never state. Heartbeats are not news.
   */
  subscribeEvents(opts: {
    subscriptions: Array<{ type: string; pane_id?: string }>;
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void } {
    let acked = false;
    const end = this.open(
      "events.subscribe",
      {},
      (m, end) => {
        if (m.kind === "error") end(m.message);
        else if (m.kind === "reply" && !acked) {
          acked = true;
          clearTimeout(ackTimer);
          opts.onUp();
        } else if (m.kind === "event" && m.type !== "heartbeat") opts.onEvent(m.type, m.data);
      },
      (reason) => {
        clearTimeout(ackTimer);
        opts.onDown(reason);
      },
    );
    const ackTimer = setTimeout(() => end("ack timeout"), 5000);
    return { close: () => end("closed") };
  }

  async getPane(paneId: string): Promise<WirePane> {
    return toWirePane(await this.request<HcTerminal>("terminal.get", { terminal: paneId }));
  }

  async getAgent(target: string): Promise<WireAgent> {
    return this.getPane(target);
  }

  /** Plain text, no ANSI (that would be `terminal.attach`); `visible` is the screen alone. */
  async readPane(paneId: string, source: ReadSource, lines: number): Promise<PaneRead> {
    const r = await this.request<{ text: string; complete: boolean }>("terminal.read", {
      terminal: paneId,
      lines: source === "visible" ? 0 : lines,
    });
    return { pane_id: paneId, text: r.text, truncated: !r.complete, revision: 0 };
  }

  async paneProcess(paneId: string): Promise<{ pid: number; cwd: string; name: string } | null> {
    const t = await this.request<HcTerminal>("terminal.get", { terminal: paneId });
    return t.foreground ? { pid: t.foreground.pid, cwd: t.foreground.cwd, name: t.foreground.name } : null;
  }

  // ── Writes: phase 3 ──
  private no(op: string): Promise<never> {
    return Promise.reject(new MuxUnsupported("hc", op));
  }
  createWorkspace(): Promise<CreatedShell> { return this.no("createWorkspace"); }
  createTab(): Promise<CreatedShell> { return this.no("createTab"); }
  renameTab(): Promise<void> { return this.no("renameTab"); }
  closeTab(): Promise<void> { return this.no("closeTab"); }
  sendPaneText(): Promise<void> { return this.no("sendPaneText"); }
  sendPaneKeys(): Promise<void> { return this.no("sendPaneKeys"); }
  closePane(): Promise<void> { return this.no("closePane"); }
  renamePane(): Promise<void> { return this.no("renamePane"); }
  reportPaneMetadata(): Promise<void> { return this.no("reportPaneMetadata"); }
  createWorktree(): Promise<CreatedWorktree> { return this.no("createWorktree"); }
  openWorktree(): Promise<CreatedWorktree> { return this.no("openWorktree"); }
  removeWorktree(): Promise<void> { return this.no("removeWorktree"); }
  startAgent(): Promise<void> { return this.no("startAgent"); }
  promptAgent(): Promise<void> { return this.no("promptAgent"); }
}
