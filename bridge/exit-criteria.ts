// The four exit criteria of ADR 0052 §8 (leaving herdr 0.9), each held or not:
//   1. hc's protocol generation unchanged for two months — the date it was first seen is durable;
//   2. every machine of the operator on hc — read from what each bridge says of its engine;
//   3. the non-Claude harnesses announce OSC 7501, or keep the screen adapter } the operator's word,
//   4. herdr 0.9 no longer receives fixes                                      } ticked by hand, durable.
// Nothing here polls: the hello is the one the hc adapter already keeps, the peers are PeerHerd's.

import { PANE_HEADER } from "./board-routes.ts";
import type { HcHello, MachineEngine } from "./mux/mux.ts";

export interface ExitState {
  harnesses: boolean;
  herdr09Frozen: boolean;
  /** The protocol generation last seen at a hello, and when this board first saw it. */
  protocol: { generation: number; version: string | null; since: number } | null;
}

export interface ExitStore {
  exitCriteria(): string | null;
  setExitCriteria(json: string): void;
}

export function readExitState(db: ExitStore): ExitState {
  let v: Partial<ExitState> = {};
  try {
    v = (JSON.parse(db.exitCriteria() ?? "{}") as Partial<ExitState> | null) ?? {};
  } catch {
    // an unreadable row reads as nothing ticked, nothing seen
  }
  const p = v.protocol;
  return {
    harnesses: v.harnesses === true,
    herdr09Frozen: v.herdr09Frozen === true,
    protocol: p && typeof p.generation === "number" && typeof p.since === "number" ? { generation: p.generation, version: typeof p.version === "string" ? p.version : null, since: p.since } : null,
  };
}

/** What a hello changes: a new generation restarts the clock, a new release of the same one only renames it. Pure. */
export function withHello(state: ExitState, hello: HcHello | null, now: number): ExitState | null {
  if (hello?.generation == null) return null;
  const p = state.protocol;
  if (p?.generation === hello.generation && p.version === hello.version) return null;
  return { ...state, protocol: { generation: hello.generation, version: hello.version, since: p?.generation === hello.generation ? p.since : now } };
}

/** The `engine.onUpdate` consumer: writes only when the hello it is handed differs from the last one it saw. */
export function protocolWatch(db: ExitStore, hello: () => HcHello | null, now: () => number = Date.now): () => void {
  let seen = "";
  return () => {
    const h = hello();
    const key = `${h?.generation}/${h?.version}`;
    if (key === seen) return;
    seen = key;
    const next = withHello(readExitState(db), h, now());
    if (next) db.setExitCriteria(JSON.stringify(next));
  };
}

export const PROTOCOL_STABLE_MONTHS = 2;

export interface ExitMachine {
  name: string;
  engine: MachineEngine | null;
}

export interface ExitView {
  protocol: { held: boolean; generation: number | null; version: string | null; since: number | null; due: number | null };
  machines: { held: boolean; onHc: number; total: number; list: { name: string; engine: "hc" | "herdr09" | null }[] };
  harnesses: { held: boolean };
  herdr09: { held: boolean };
}

/** The four criteria. Pure. A machine whose engine is unknown counts as not on hc. */
export function exitView(state: ExitState, machines: readonly ExitMachine[], now: number): ExitView {
  const p = state.protocol;
  let due: number | null = null;
  if (p) {
    const d = new Date(p.since);
    d.setMonth(d.getMonth() + PROTOCOL_STABLE_MONTHS);
    due = d.getTime();
  }
  const list = machines.map((m) => ({ name: m.name, engine: m.engine?.engine ?? null }));
  const onHc = list.filter((m) => m.engine === "hc").length;
  return {
    protocol: { held: due !== null && now >= due, generation: p?.generation ?? null, version: p?.version ?? null, since: p?.since ?? null, due },
    machines: { held: list.length > 0 && onHc === list.length, onHc, total: list.length, list },
    harnesses: { held: state.harnesses },
    herdr09: { held: state.herdr09Frozen },
  };
}

export interface ExitRouteDeps {
  db: ExitStore;
  machines: () => ExitMachine[];
  guard: (level: "read" | "write") => Response | null;
  audit: (action: string, detail: Record<string, unknown>) => void;
  json: (data: unknown, status?: number) => Response;
  text: (body: string, status: number) => Response;
  now?: () => number;
}

const EXIT_ROUTE = "/api/exit-criteria";

/** `GET /api/exit-criteria`, and `POST` `{harnesses?, herdr09Frozen?}` — the operator's two ticks. Null for any other path. */
export async function handleExitRoute(pathname: string, req: Request, d: ExitRouteDeps): Promise<Response | null> {
  if (pathname !== EXIT_ROUTE) return null;
  const view = () => d.json(exitView(readExitState(d.db), d.machines(), (d.now ?? Date.now)()));
  if (req.method === "GET") return d.guard("read") ?? view();
  if (req.method !== "POST") return d.text("method not allowed", 405);
  const denied = d.guard("write");
  if (denied) return denied;
  if (req.headers.get(PANE_HEADER)?.trim()) return d.text("the exit criteria are the operator's to tick — an agent pane may not", 403);
  let b: unknown;
  try {
    b = await req.json();
  } catch {
    return d.text("bad body", 400);
  }
  if (typeof b !== "object" || b === null) return d.text("bad body", 400);
  const { harnesses, herdr09Frozen } = b as { harnesses?: unknown; herdr09Frozen?: unknown };
  if ((harnesses !== undefined && typeof harnesses !== "boolean") || (herdr09Frozen !== undefined && typeof herdr09Frozen !== "boolean")) return d.text("harnesses / herdr09Frozen must be booleans", 400);
  const state = readExitState(d.db);
  const next = { ...state, ...(harnesses !== undefined ? { harnesses } : {}), ...(herdr09Frozen !== undefined ? { herdr09Frozen } : {}) };
  d.db.setExitCriteria(JSON.stringify(next));
  d.audit("exit-criteria.set", { harnesses: next.harnesses, herdr09Frozen: next.herdr09Frozen });
  return view();
}
