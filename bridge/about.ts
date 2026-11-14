// Settings → About: how THIS Collie runs, read-only, for an operator without a shell at hand.
// One row per moving part, each with a state the screen colours and a `key` the screen turns into a
// sentence (and, when the state isn't ok, into what to do). Never a secret: VAPID keys, peer tokens
// and the like are reported as "configured", never as their value — the facts below are booleans,
// counts, names and versions only.

import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import type { MachineEngine } from "./mux/mux.ts";

/** ok = green, todo = something for the operator to do, down = broken, off = not in use (neutral). */
export type AboutState = "ok" | "todo" | "down" | "off";

export interface AboutRow {
  id: "version" | "engine" | "hc" | "service" | "frontDoor" | "push" | "copilot" | "lead" | "cost" | "peers";
  state: AboutState;
  key: string;
  vars?: Record<string, string | number>;
}

export interface AboutFacts {
  version: { current: string; build: string | null; latest: string | null; releaseAvailable: boolean; bridgeStale: boolean };
  engine: MachineEngine | null;
  hc: { reachable: boolean; socket: string };
  /** null off Linux: no systemd to ask. */
  service: { systemd: boolean; enabled: boolean; linger: boolean } | null;
  skipServe: boolean;
  push: { enabled: boolean; devices: number };
  copilot: { enabled: boolean; alive: boolean };
  /** The lot lead's pane: null while no lot runs. */
  lead: { paneId: string | null; alive: boolean };
  /** What the lead and the copilot consumed since the bridge started — they serve every repo, so no project owns it. */
  board: { known: boolean; tokens: number };
  peers: { name: string; state: "pending" | "connected" | "disconnected" }[];
}

/** The rows, in reading order. Pure. */
export function aboutRows(f: AboutFacts): AboutRow[] {
  const v = f.version;
  const vv = { current: v.current, build: v.build ?? "?" };
  const peersDown = f.peers.filter((p) => p.state === "disconnected").map((p) => p.name);
  const peersUp = f.peers.filter((p) => p.state === "connected").length;
  return [
    v.bridgeStale
      ? { id: "version", state: "todo", key: "stale", vars: vv }
      : v.releaseAvailable
        ? { id: "version", state: "todo", key: "update", vars: { ...vv, latest: v.latest ?? "?" } }
        : { id: "version", state: "ok", key: "current", vars: vv },
    !f.engine
      ? { id: "engine", state: "down", key: "none" }
      : f.engine.engine === "hc"
        ? { id: "engine", state: "ok", key: "hc", vars: { version: f.engine.hc?.version ?? "?" } }
        : { id: "engine", state: "todo", key: "herdr09" },
    { id: "hc", state: f.hc.reachable ? "ok" : "down", key: f.hc.reachable ? "up" : "down", vars: { socket: f.hc.socket } },
    !f.service
      ? { id: "service", state: "off", key: "na" }
      : !f.service.systemd
        ? { id: "service", state: "todo", key: "manual" }
        : !f.service.enabled
          ? { id: "service", state: "todo", key: "notEnabled" }
          : !f.service.linger
            ? { id: "service", state: "todo", key: "noLinger" }
            : { id: "service", state: "ok", key: "ok" },
    { id: "frontDoor", state: "ok", key: f.skipServe ? "proxy" : "tailscale" },
    !f.push.enabled
      ? { id: "push", state: "todo", key: "off" }
      : f.push.devices === 0
        ? { id: "push", state: "todo", key: "none" }
        : { id: "push", state: "ok", key: "on", vars: { devices: f.push.devices } },
    !f.copilot.enabled
      ? { id: "copilot", state: "off", key: "off" }
      : { id: "copilot", state: "ok", key: f.copilot.alive ? "live" : "idle" },
    !f.lead.paneId
      ? { id: "lead", state: "off", key: "none" }
      : f.lead.alive
        ? { id: "lead", state: "ok", key: "live" }
        : { id: "lead", state: "down", key: "dead" },
    f.board.known ? { id: "cost", state: "ok", key: "total", vars: { n: f.board.tokens } } : { id: "cost", state: "off", key: "unknown" },
    f.peers.length === 0
      ? { id: "peers", state: "off", key: "none" }
      : peersDown.length
        ? { id: "peers", state: "down", key: "some", vars: { up: peersUp, total: f.peers.length, down: peersDown.join(", ") } }
        : { id: "peers", state: "ok", key: "all", vars: { up: peersUp, total: f.peers.length } },
  ];
}

/** The systemd --user facts, read off the filesystem (no shell): the unit's own env, its wants link, the linger flag. */
export function readService(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, platform = process.platform): AboutFacts["service"] {
  if (platform !== "linux") return null;
  let user = env.USER ?? "";
  try {
    user = userInfo().username;
  } catch {
    // keep $USER
  }
  return {
    // systemd sets INVOCATION_ID for every unit it starts; a bare `bun` in a terminal has none.
    systemd: Boolean(env.INVOCATION_ID),
    enabled: exists(join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd/user/default.target.wants/collie-board.service")),
    linger: Boolean(user) && exists(join("/var/lib/systemd/linger", user)),
  };
}

export const ABOUT_ROUTE = "/api/about";

/** `GET /api/about` — read-only. Null for any other path. */
export async function handleAboutRoute(
  pathname: string,
  req: Request,
  d: { facts: () => Promise<AboutFacts>; guard: (level: "read") => Response | null; json: (data: unknown) => Response; text: (body: string, status: number) => Response },
): Promise<Response | null> {
  if (pathname !== ABOUT_ROUTE) return null;
  if (req.method !== "GET") return d.text("method not allowed", 405);
  return d.guard("read") ?? d.json({ rows: aboutRows(await d.facts()) });
}
