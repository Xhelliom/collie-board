import { basename } from "node:path";
import type { AgentStatus } from "../types.ts";
import { hcSocketPath, type Config } from "../config.ts";
import { DEFAULT_TIMEOUT_MS, Herdr09 } from "./herdr09.ts";
import { Hc } from "./hc.ts";
import { CompositeMux } from "./composite.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The multiplexer the bridge drives — herdr 0.9 today, herdr-core (hc) next (ADR 0052 §4).
// `Mux` is cut to what the consumers actually call, nothing more; the data shapes below are still
// herdr 0.9's, because that is what every consumer reads. The primary session reads BOTH engines
// through {@link CompositeMux}; `cfg.mux` only picks where a new pane is launched.
//
// An engine that cannot do something (hc has no workspace, no tab, no focus) rejects with
// {@link MuxUnsupported} instead of inventing a result: every consumer already treats a rejected
// call as a failed action, so "not supported" lands on the same path as "herdr said no".
// ─────────────────────────────────────────────────────────────────────────────

/** An engine: herdr 0.9, or hc. */
export type MuxKind = Exclude<NonNullable<Config["mux"]>, "auto">;

/** Thrown (as a rejection) by an engine for an operation it has no equivalent for. */
export class MuxUnsupported extends Error {
  constructor(readonly mux: MuxKind, readonly op: string) {
    super(`${mux}: ${op} is not supported`);
    this.name = "MuxUnsupported";
  }
}

/** Raw wire shape of a workspace from `workspace.list`. */
export interface WireWorkspace {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
}

/** Raw wire shape of a tab from `tab.list`. */
export interface WireTab {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
}

/** Raw wire shape of a pane from `pane.list` (and, identically, inside `session.snapshot`). */
export interface WirePane {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd: string;
  foreground_cwd?: string;
  agent?: string | null;
  agent_status: AgentStatus;
  /** User-set pane label (herdr `pane.rename`). Present only once set — the key disappears when
   *  cleared with `label: null`, so absent/null both read as "no label". */
  label?: string | null;
  revision: number;
  /** hc only: names of the live terminals this one started (its `children_of`) — the agent's subagents. */
  children?: string[];
  /** The engine this pane lives on — stamped by {@link CompositeMux}, never by an engine itself. */
  engine?: MuxKind;
  /**
   * The agent's OWN session identity, as the agent reported it to Herdr (herdr ≥ 0.7.2). For Claude
   * this is `{kind:"id", value:"<uuid>"}` — the uuid naming its on-disk session log, which is how
   * Collie serves real conversation history for a pane whose terminal keeps no scrollback (see
   * transcript.ts). Optional + defensively typed: older servers omit it, and `kind` may be something
   * other than "id" for other agents.
   */
  agent_session?: {
    source?: string;
    agent?: string;
    kind?: string;
    value?: string;
  } | null;
  /**
   * Scroll geometry (herdr ≥ 0.7.2); optional so older servers that omit it still typecheck.
   *
   * `max_offset_from_bottom` is how far the pane can scroll UP — the depth of its scrollback ring —
   * so `max_offset_from_bottom + viewport_rows` is the line count a `pane.read source:"recent"` can
   * return. Live-verified on a sandbox pane (2026-07-26): 95+31 → 127 lines read, 498+31 → 530 (the
   * +1 is the trailing newline). Exact once scrollback exists; an OVER-estimate on a near-empty
   * screen, where trailing blank rows are trimmed from the read (0+31 → 4 lines read).
   *
   * Gate "is there more to load" on this, never on `PaneRead.truncated` — which is a lie on every
   * server this plugin supports the floor of. Through 0.7.x it is ALWAYS false, even when a read
   * demonstrably cut scrollback off (200 requested of 6895 available still reports
   * `truncated: false`). 0.8.0 fixed it (upstream #1717, live-verified 2026-08-07: 5 of 66 lines →
   * `true`, 100 of 66 → `false`), but `min_herdr_version` is 0.7.0, so switching would silently
   * report "nothing more to fetch" to anyone on an older server. `scroll` is right on both.
   */
  scroll?: {
    offset_from_bottom: number;
    max_offset_from_bottom: number;
    viewport_rows: number;
  } | null;
}

/**
 * Raw shape of `session.snapshot` — the whole herd in one reply, superseding the three parallel
 * list calls. `agents`/`layouts`/`focused_*` are carried too but intentionally unused: agents stay
 * derived from `panes` so there's one code path. Older servers predate the method (see StateEngine).
 */
export interface WireSnapshot {
  version: string;
  protocol: number;
  workspaces: WireWorkspace[];
  tabs: WireTab[];
  panes: WirePane[];
}

/** The freshly-created shell pane returned by tab.create / workspace.create (`root_pane`). */
export interface CreatedShell {
  paneId: string;
  workspaceId: string;
  workspaceLabel?: string;
  tabId: string;
  cwd: string;
}

export interface PaneRead {
  pane_id: string;
  text: string;
  truncated: boolean;
  revision: number;
}

// SNAKE_case on the wire — `recent-unwrapped` (the CLI's `--source` spelling, and what this type
// said until 2026-07-30) is rejected with `invalid_request: unknown variant`. Live-probed against
// herdr's socket; the hyphenated form has never worked.
export type ReadSource = "visible" | "recent" | "recent_unwrapped";
export type ReadFormat = "text" | "ansi";

/**
 * Raw `agent.get` reply. A superset of {@link WirePane} with the launch-state fields — which are
 * present ONLY on agent records, and only while they mean something (herdr omits them once settled,
 * so `undefined` reads as "not launching" / "unknown", never as false).
 */
export interface WireAgent extends WirePane {
  name?: string | null;
  /** True while herdr is still bringing the agent up; `agent.prompt` is refused until it clears. */
  launch_pending?: boolean;
  /** True once the agent's TUI will accept a prompt. THE readiness signal. */
  interactive_ready?: boolean;
}

/**
 * Where herdr-app files a pane the BOARD starts (hc only — herdr 0.9 has its own workspaces and ignores
 * it): one tab per `tab` id, titled `title`, in the one « Collie Board » space. Never set it for a
 * shell the operator opens himself: his terminals stay out of that space.
 */
export interface BoardTab {
  tab: string;
  title: string;
}

/** « <dépôt> · <quoi> » — the title every board tab carries. */
export const boardTab = (tab: string, repoPath: string, what: string): BoardTab => ({ tab, title: `${basename(repoPath)} · ${what}` });

/** A worktree-backed workspace, ready to launch an agent in. */
export interface CreatedWorktree {
  /** Absolute path of the checkout — the cwd every `git` call for this card runs in. */
  checkoutPath: string;
  branch: string | null;
  workspaceId: string;
  workspaceLabel: string;
  tabId: string;
  paneId: string;
  /** True when the workspace was already open, so nothing was created. */
  alreadyOpen: boolean;
}


export interface Mux {
  /** Reachability check for the connected/disconnected banner. Never rejects. */
  ping(): Promise<boolean>;

  // ── The herd ──
  sessionSnapshot(): Promise<WireSnapshot>;
  /** Fallback for a server without `sessionSnapshot` — see StateEngine. */
  listWorkspaces(): Promise<WireWorkspace[]>;
  listTabs(): Promise<WireTab[]>;
  listPanes(): Promise<WirePane[]>;
  /** Long-lived stream that only POKES re-polls; `onDown` fires exactly once. See EventPoker. */
  subscribeEvents(opts: {
    subscriptions: Array<{ type: string; pane_id?: string }>;
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void };

  // ── Spaces and tabs (no hc equivalent: an hc engine rejects with MuxUnsupported) ──
  createWorkspace(opts: { cwd: string; label?: string; show?: BoardTab }): Promise<CreatedShell>;
  createTab(workspaceId: string, opts?: { label?: string; cwd?: string; show?: BoardTab }): Promise<CreatedShell>;
  renameTab(tabId: string, label: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;

  // ── Panes ──
  getPane(paneId: string): Promise<WirePane>;
  readPane(paneId: string, source: ReadSource, lines: number, format?: ReadFormat): Promise<PaneRead>;
  sendPaneText(paneId: string, text: string): Promise<void>;
  /** Paste and Enter in ONE engine call — only an engine that has no paste without Enter (hc).
   *  `force` types into a program blocked on a dialog: the caller has read it and means to answer. */
  sendPaneLine?(paneId: string, text: string, force: boolean): Promise<void>;
  sendPaneKeys(paneId: string, keys: string[]): Promise<void>;
  closePane(paneId: string): Promise<void>;
  renamePane(paneId: string, label: string | null): Promise<void>;
  reportPaneMetadata(opts: {
    paneId: string;
    source: string;
    tokens: Record<string, string | null>;
    ttlMs?: number;
  }): Promise<void>;
  paneProcess(paneId: string): Promise<{ pid: number; cwd: string; name: string } | null>;

  // ── Worktrees ──
  createWorktree(opts: { cwd: string; branch: string; base?: string | null; label?: string; show?: BoardTab }): Promise<CreatedWorktree>;
  openWorktree(opts: { cwd: string; branch: string; label?: string; show?: BoardTab }): Promise<CreatedWorktree>;
  removeWorktree(opts: { workspaceId: string; force?: boolean }): Promise<void>;

  // ── Agents — only through launchAgent()/promptAndConfirm() in cards.ts ──
  startAgent(opts: { paneId: string; kind: string; name: string; args?: string[]; timeoutMs?: number }): Promise<void>;
  getAgent(target: string): Promise<WireAgent>;
  /** hc says whether the prompt took (`started`; null = it can't tell); herdr 0.9 says nothing (void). */
  promptAgent(opts: { target: string; text: string; until?: AgentStatus[]; timeoutMs?: number }): Promise<boolean | null | void>;
}

/** What an hc core says of itself at `hello`: its release, and its protocol generation (ADR 0052 §8, criterion 1). */
export interface HcHello {
  version: string | null;
  generation: number | null;
}

/** The engine a machine runs on, for the machines page and ADR 0052 §8's criterion 2. `hc` null: no hello answered. */
export interface MachineEngine {
  engine: MuxKind;
  hc: HcHello | null;
}

/**
 * herdr 0.9 on `socketPath`, plus — on the primary session — hc on its own socket, merged by
 * {@link CompositeMux}; new panes go to `cfg.mux` (`auto`: hc while it answers). Other herdr sessions are 0.9 alone (one hc per machine).
 */
export function createMux(socketPath: string, cfg: Pick<Config, "mux" | "dialMode">, withHc = true): Mux {
  const herdr09 = new Herdr09(socketPath, DEFAULT_TIMEOUT_MS, cfg.dialMode);
  if (!withHc) return herdr09;
  return new CompositeMux({ herdr09, hc: new Hc(hcSocketPath(), cfg.dialMode) }, cfg.mux ?? "auto");
}
