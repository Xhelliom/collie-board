import { HC_SPACE } from "./hc.ts";
import {
  type BoardTab,
  MuxUnsupported,
  type CreatedShell,
  type CreatedWorktree,
  type HcHello,
  type MachineEngine,
  type Mux,
  type MuxKind,
  type PaneRead,
  type ReadFormat,
  type ReadSource,
  type WireAgent,
  type WirePane,
  type WireSnapshot,
} from "./mux.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Both engines at once (ADR 0052 §4.2, amended 2026-11-06): the herd is herdr 0.9's panes AND hc's
// terminals, merged. Each pane belongs to exactly one engine, so there are never two truths about it.
//
// - Ownership is read off the id, never stored: hc's addresses are `t` + base 36 (`t3`, `t1b`, `t1m`: not hex), its one space/tab is
//   `hc`; herdr 0.9's are `w…`, `w…:t1`, `w…:p1`. So a 0.9 id (card, session, `/pane/<id>` URL)
//   stays exactly what it was, and HC_TERMINAL_ID still names its pane (provenance, ADR 0010).
// - Reads are merged; every action goes to the pane's owner; a NEW pane (space, worktree) goes to
//   `launch` (`cfg.mux`). `auto` (the default since phase 4) is hc when hc answered the last
//   snapshot, else herdr 0.9 — and {@link CompositeMux.launchEngine} says it fell back, for the UI.
// - An engine that fails does not empty the other: its last good panes are kept for a grace while it
//   blips, then dropped. Only when every engine fails does the snapshot reject (= disconnected).
// ─────────────────────────────────────────────────────────────────────────────

/** How long a failing engine's last panes stand in for it — a socket blip, not a stop. */
export const STALE_GRACE_MS = 60_000;

/** The engine an id (pane, tab, space, agent target) belongs to. */
export function ownerOf(id: string): MuxKind {
  return id === HC_SPACE || /^t[0-9a-z]+$/.test(id) ? "hc" : "herdr09";
}

type Part = { snap: WireSnapshot; at: number };

export class CompositeMux implements Mux {
  private readonly last = new Map<MuxKind, Part>();
  /** herdr 0.9 servers predating `session.snapshot` (StateEngine's fallback, per engine here). */
  private readonly listOnly = new Set<MuxKind>();
  /** Whether hc answered the last snapshot — what `auto` launches on. */
  private hcUp = false;

  constructor(
    private readonly engines: Partial<Record<MuxKind, Mux>>,
    private readonly launch: MuxKind | "auto",
    private readonly now: () => number = Date.now,
  ) {}

  /** Where a new pane goes now; `fallback` = `auto` wanted hc and hc is not answering. */
  launchEngine(): { engine: MuxKind; fallback: boolean } {
    if (this.launch !== "auto") return { engine: this.launch, fallback: false };
    if (this.engines.hc && this.hcUp) return { engine: "hc", fallback: false };
    return { engine: "herdr09", fallback: Boolean(this.engines.hc) };
  }

  /** What this machine runs on: where a launch goes now, and hc's last hello if it has a core. */
  machineEngine(): MachineEngine {
    return { engine: this.launchEngine().engine, hc: (this.engines.hc as { hello?: HcHello | null } | undefined)?.hello ?? null };
  }

  private kinds(): MuxKind[] {
    return Object.keys(this.engines) as MuxKind[];
  }

  private on(kind: MuxKind, op: string): Mux {
    const m = this.engines[kind];
    if (!m) throw new MuxUnsupported(kind, `${op} (engine not on this bridge)`);
    return m;
  }

  /** The owner of `id`, as a promise so a missing engine rejects like any refused action. */
  private async to(id: string, op: string): Promise<Mux> {
    return this.on(ownerOf(id), op);
  }

  private async fetch(kind: MuxKind, m: Mux): Promise<WireSnapshot> {
    if (!this.listOnly.has(kind)) {
      try {
        return await m.sessionSnapshot();
      } catch (err) {
        if (!(err instanceof Error && err.message.includes("unknown variant"))) throw err;
        this.listOnly.add(kind);
      }
    }
    const [workspaces, panes, tabs] = await Promise.all([m.listWorkspaces(), m.listPanes(), m.listTabs()]);
    return { version: "", protocol: 0, workspaces, panes, tabs };
  }

  async ping(): Promise<boolean> {
    return (await Promise.all(this.kinds().map((k) => this.engines[k]!.ping()))).some(Boolean);
  }

  async sessionSnapshot(): Promise<WireSnapshot> {
    const kinds = this.kinds();
    const got = await Promise.allSettled(kinds.map((k) => this.fetch(k, this.engines[k]!)));
    this.hcUp = got[kinds.indexOf("hc")]?.status === "fulfilled";
    if (got.every((g) => g.status === "rejected")) throw (got[0] as PromiseRejectedResult).reason;
    const t = this.now();
    const parts: WireSnapshot[] = [];
    got.forEach((g, i) => {
      const kind = kinds[i]!;
      if (g.status === "fulfilled") {
        const snap = { ...g.value, panes: g.value.panes.map((p): WirePane => ({ ...p, engine: kind })) };
        this.last.set(kind, { snap, at: t });
        parts.push(snap);
      } else {
        const prev = this.last.get(kind);
        if (prev && t - prev.at <= STALE_GRACE_MS) parts.push(prev.snap);
      }
    });
    return {
      version: parts.map((p) => p.version).filter(Boolean).join(" + "),
      protocol: parts[0]?.protocol ?? 0,
      workspaces: parts.flatMap((p) => p.workspaces),
      tabs: parts.flatMap((p) => p.tabs),
      panes: parts.flatMap((p) => p.panes),
    };
  }

  async listWorkspaces() { return (await this.sessionSnapshot()).workspaces; }
  async listTabs() { return (await this.sessionSnapshot()).tabs; }
  async listPanes() { return (await this.sessionSnapshot()).panes; }

  /**
   * One stream per engine, each asked only for its own panes. Up on the first engine up; down (once)
   * when an engine that WAS up drops, or when none ever came up — an absent engine alone never keeps
   * the other's stream cycling. One coming up later is picked up at the next re-subscribe.
   */
  subscribeEvents(opts: {
    subscriptions: Array<{ type: string; pane_id?: string }>;
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void } {
    const kinds = this.kinds();
    let announced = false;
    let down = false;
    let ended = 0;
    const streams: Array<{ close(): void }> = [];
    const fail = (reason: string) => {
      if (down) return;
      down = true;
      for (const s of streams) s.close();
      opts.onDown(reason);
    };
    for (const kind of kinds) {
      let up = false;
      streams.push(
        this.engines[kind]!.subscribeEvents({
          subscriptions: opts.subscriptions.filter((s) => !s.pane_id || ownerOf(s.pane_id) === kind),
          onUp: () => {
            up = true;
            if (!announced) {
              announced = true;
              opts.onUp();
            }
          },
          onEvent: opts.onEvent,
          onDown: (reason) => {
            ended++;
            if (up || ended === kinds.length) fail(`${kind}: ${reason}`);
          },
        }),
      );
    }
    return {
      close: () => {
        down = true;
        for (const s of streams) s.close();
      },
    };
  }

  // ── Spaces and tabs: a new space is a launch; the rest goes to the owner ──
  createWorkspace(opts: { cwd: string; label?: string; show?: BoardTab }): Promise<CreatedShell> {
    return this.on(this.launchEngine().engine, "createWorkspace").createWorkspace(opts);
  }
  async createTab(workspaceId: string, opts?: { label?: string; cwd?: string; show?: BoardTab }) {
    return (await this.to(workspaceId, "createTab")).createTab(workspaceId, opts);
  }
  async renameTab(tabId: string, label: string) { return (await this.to(tabId, "renameTab")).renameTab(tabId, label); }
  async closeTab(tabId: string) { return (await this.to(tabId, "closeTab")).closeTab(tabId); }

  // ── Panes: always the owner ──
  async getPane(paneId: string) { return (await this.to(paneId, "getPane")).getPane(paneId); }
  async readPane(paneId: string, source: ReadSource, lines: number, format?: ReadFormat): Promise<PaneRead> {
    return (await this.to(paneId, "readPane")).readPane(paneId, source, lines, format);
  }
  async sendPaneText(paneId: string, text: string) { return (await this.to(paneId, "sendPaneText")).sendPaneText(paneId, text); }
  async sendPaneLine(paneId: string, text: string, force: boolean) {
    const m = await this.to(paneId, "sendPaneLine");
    if (!m.sendPaneLine) throw new MuxUnsupported(ownerOf(paneId), "sendPaneLine");
    return m.sendPaneLine(paneId, text, force);
  }
  async sendPaneKeys(paneId: string, keys: string[]) { return (await this.to(paneId, "sendPaneKeys")).sendPaneKeys(paneId, keys); }
  async closePane(paneId: string) { return (await this.to(paneId, "closePane")).closePane(paneId); }
  async renamePane(paneId: string, label: string | null) { return (await this.to(paneId, "renamePane")).renamePane(paneId, label); }
  async reportPaneMetadata(opts: { paneId: string; source: string; tokens: Record<string, string | null>; ttlMs?: number }) {
    return (await this.to(opts.paneId, "reportPaneMetadata")).reportPaneMetadata(opts);
  }
  async paneProcess(paneId: string) { return (await this.to(paneId, "paneProcess")).paneProcess(paneId); }

  // ── Worktrees: a new checkout's pane is a launch; removing one goes to its space's owner ──
  createWorktree(opts: { cwd: string; branch: string; base?: string | null; label?: string; show?: BoardTab }): Promise<CreatedWorktree> {
    return this.on(this.launchEngine().engine, "createWorktree").createWorktree(opts);
  }
  openWorktree(opts: { cwd: string; branch: string; label?: string; show?: BoardTab }): Promise<CreatedWorktree> {
    return this.on(this.launchEngine().engine, "openWorktree").openWorktree(opts);
  }
  async removeWorktree(opts: { workspaceId: string; force?: boolean }) {
    return (await this.to(opts.workspaceId, "removeWorktree")).removeWorktree(opts);
  }

  // ── Agents ──
  async startAgent(opts: { paneId: string; kind: string; name: string; args?: string[]; timeoutMs?: number }) {
    return (await this.to(opts.paneId, "startAgent")).startAgent(opts);
  }
  async getAgent(target: string): Promise<WireAgent> { return (await this.to(target, "getAgent")).getAgent(target); }
  async promptAgent(opts: { target: string; text: string; until?: WireAgent["agent_status"][]; timeoutMs?: number }) {
    return (await this.to(opts.target, "promptAgent")).promptAgent(opts);
  }
}
