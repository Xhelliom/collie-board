import { describe, expect, test } from "bun:test";

import { aboutRows, readService, type AboutFacts } from "./about.ts";

const healthy: AboutFacts = {
  version: { current: "1.0.0", build: "abc", latest: "1.0.0", releaseAvailable: false, bridgeStale: false },
  engine: { engine: "hc", hc: { version: "0.3.0", generation: 2 } },
  hc: { reachable: true, socket: "/run/user/1000/herdr-core/default.sock" },
  service: { systemd: true, enabled: true, linger: true },
  skipServe: false,
  push: { enabled: true, devices: 2 },
  copilot: { enabled: true, alive: true },
  lead: { paneId: null, alive: false },
  board: { known: true, tokens: 1234 },
  peers: [{ name: "dev", state: "connected" }],
};
const row = (f: AboutFacts, id: string) => aboutRows(f).find((r) => r.id === id)!;

describe("aboutRows", () => {
  test("a healthy machine is green or neutral everywhere", () => {
    expect(aboutRows(healthy).map((r) => r.state).filter((s) => s !== "ok" && s !== "off")).toEqual([]);
    expect(row(healthy, "engine")).toEqual({ id: "engine", state: "ok", key: "hc", vars: { version: "0.3.0" } });
  });

  test("herdr 0.9 says migrate, an unreachable hc is red", () => {
    const f = { ...healthy, engine: { engine: "herdr09" as const, hc: null }, hc: { ...healthy.hc, reachable: false } };
    expect(row(f, "engine")).toMatchObject({ state: "todo", key: "herdr09" });
    expect(row(f, "hc")).toMatchObject({ state: "down", key: "down" });
  });

  test("the board's own consumption is a number when known, « unknown » otherwise — never 0", () => {
    expect(row(healthy, "cost")).toEqual({ id: "cost", state: "ok", key: "total", vars: { n: 1234 } });
    expect(row({ ...healthy, board: { known: false, tokens: 0 } }, "cost")).toMatchObject({ state: "off", key: "unknown" });
  });

  test("service, push, lead, peers each name what is wrong", () => {
    expect(row({ ...healthy, service: { systemd: true, enabled: true, linger: false } }, "service").key).toBe("noLinger");
    expect(row({ ...healthy, service: { systemd: false, enabled: false, linger: false } }, "service").key).toBe("manual");
    expect(row({ ...healthy, push: { enabled: true, devices: 0 } }, "push")).toMatchObject({ state: "todo", key: "none" });
    expect(row({ ...healthy, push: { enabled: false, devices: 0 } }, "push").key).toBe("off");
    expect(row({ ...healthy, lead: { paneId: "w1:p2", alive: false } }, "lead")).toMatchObject({ state: "down", key: "dead" });
    const peers = [...healthy.peers, { name: "nas", state: "disconnected" as const }];
    expect(row({ ...healthy, peers }, "peers")).toMatchObject({ state: "down", vars: { up: 1, total: 2, down: "nas" } });
    expect(row({ ...healthy, version: { ...healthy.version, releaseAvailable: true, latest: "1.1.0" } }, "version")).toMatchObject({ state: "todo", key: "update" });
  });

  test("no secret ever travels: the rows carry only the facts' names, counts and versions", () => {
    const json = JSON.stringify(aboutRows(healthy));
    expect(json).not.toMatch(/vapid|token|private/i);
  });
});

describe("readService", () => {
  test("reads systemd from INVOCATION_ID and the wants link / linger flag off the disk", () => {
    const seen: string[] = [];
    const s = readService({ INVOCATION_ID: "x", XDG_CONFIG_HOME: "/cfg" }, (p) => (seen.push(p), p.startsWith("/cfg")), "linux");
    expect(s).toMatchObject({ systemd: true, enabled: true, linger: false });
    expect(seen[0]).toBe("/cfg/systemd/user/default.target.wants/collie-board.service");
    expect(readService({}, () => true, "darwin")).toBeNull();
  });
});
