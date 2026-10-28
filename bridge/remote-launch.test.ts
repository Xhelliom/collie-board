import { describe, expect, it } from "bun:test";

import { BoardDb, type BoardEvent } from "./db.ts";
import { normalizeRemote } from "./git.ts";
import type { OutboundPeer } from "./pairing.ts";
import {
  endOnPeer,
  environmentChangeRefusal,
  environmentsForRemote,
  launchRouteFor,
  parseCardEnvironment,
  peerRefusal,
  remoteSessionFor,
  remoteSessionOf,
  startOnPeer,
  type RemoteDeps,
} from "./remote-launch.ts";

const DEV: OutboundPeer = { name: "dev", url: "https://dev.example.ts.net", token: "t".repeat(43), pairedAt: "" };

describe("normalizeRemote", () => {
  it("gives every protocol of one repo the same key, without the user or token", () => {
    const key = "github.com/xhelliom/collie-board";
    for (const url of [
      "git@github.com:Xhelliom/collie-board.git",
      "ssh://git@github.com:22/Xhelliom/collie-board.git",
      "https://github.com/Xhelliom/collie-board",
      "https://x-access-token:secret@github.com/Xhelliom/collie-board.git/",
    ]) {
      expect(normalizeRemote(url)).toBe(key);
    }
  });

  it("has no key for a local path, a file URL, a Windows drive or nothing", () => {
    for (const url of ["/home/me/repo", "file:///home/me/repo", "C:\\repo", "C:repo", "", null]) expect(normalizeRemote(url)).toBeNull();
  });

  it("keeps two repos apart", () => {
    expect(normalizeRemote("git@github.com:a/x.git")).not.toBe(normalizeRemote("git@github.com:a/y.git"));
    expect(normalizeRemote("git@gitlab.com:a/x.git")).not.toBe(normalizeRemote("git@github.com:a/x.git"));
  });
});

describe("environmentsForRemote", () => {
  const envs = [
    { peer: "dev", name: "dev-board", agent: "claude", remote: "github.com/x/board" },
    { peer: "dev", name: "dev-cad", agent: "claude", remote: "github.com/x/cad" },
    { peer: "win", name: "win-board", agent: "codex", remote: "github.com/x/board" },
    { peer: "win", name: "scratch", agent: "claude", remote: null },
  ];
  it("offers only the environments whose origin is this repo's", () => {
    expect(environmentsForRemote("github.com/x/board", envs).map((e) => e.name)).toEqual(["dev-board", "win-board"]);
  });
  it("offers none for a repo with no origin — not the environments with none either", () => {
    expect(environmentsForRemote(null, envs)).toEqual([]);
  });
});

describe("launchRouteFor", () => {
  it("routes a card with no environment here", () => {
    expect(launchRouteFor(null, [DEV])).toEqual({ kind: "local" });
  });
  it("routes a card to the peer its environment names", () => {
    expect(launchRouteFor({ peer: "dev", name: "dev-board" }, [DEV])).toEqual({ kind: "peer", peer: DEV, environment: "dev-board" });
  });
  it("refuses — never falls back here — when that peer is not paired", () => {
    const r = launchRouteFor({ peer: "win", name: "win-cad" }, [DEV]);
    expect(r).toEqual({ kind: "refused", error: "win-cad: win is not a paired peer of this machine" });
  });
});

describe("parseCardEnvironment", () => {
  it("takes {peer, name} or null", () => {
    expect(parseCardEnvironment(null)).toEqual({ ok: true, value: null });
    expect(parseCardEnvironment({ peer: "dev", name: "dev-board" })).toEqual({ ok: true, value: { peer: "dev", name: "dev-board" } });
  });
  it("refuses a path, an extra field, a bad name", () => {
    expect(parseCardEnvironment({ peer: "dev", name: "x", repoPath: "/etc" }).ok).toBe(false);
    expect(parseCardEnvironment({ peer: "../dev", name: "x" }).ok).toBe(false);
    expect(parseCardEnvironment("dev").ok).toBe(false);
  });
});

describe("remoteSessionOf", () => {
  const ev = (id: number, type: string, payload: unknown): BoardEvent => ({ id, cardId: "c", type, payload, ts: id });
  const launched = { peer: "dev", environment: "dev-board", paneId: "w1:p2", branch: "board/x" };
  it("is the last launch, newest first", () => {
    expect(remoteSessionOf([ev(3, "card.edited", {}), ev(2, "card.remote_launched", launched), ev(1, "card.created", {})])).toEqual(launched);
  });
  it("is gone once ended", () => {
    expect(remoteSessionOf([ev(3, "card.remote_ended", launched), ev(2, "card.remote_launched", launched)])).toBeNull();
  });
});

describe("peerRefusal", () => {
  it("says who refused and why", () => {
    expect(peerRefusal("dev", "dev-board", { error: "connect ECONNREFUSED" })).toBe("dev-board: dev unreachable (connect ECONNREFUSED)");
    expect(peerRefusal("dev", "dev-board", { status: 403, body: { ok: false, error: 'autonomy is off for environment "dev-board" on dev' } })).toBe(
      'dev-board: dev refused — autonomy is off for environment "dev-board" on dev',
    );
    expect(peerRefusal("dev", "nope", { status: 400, body: { ok: false, error: 'environment "nope" is not declared on dev' } })).toContain("not declared on dev");
    expect(peerRefusal("dev", "dev-board", { status: 401, body: null })).toContain("pair again");
  });
});

describe("startOnPeer / endOnPeer", () => {
  function setup(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const db = new BoardDb(":memory:");
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body as string) : null });
      return answer(url, init);
    }) as unknown as typeof fetch;
    const d: RemoteDeps = { db, fetch: fetchFn, outbound: () => [DEV], branchPrefix: "board/" };
    const card = db.createCard({ title: "Lancer chez le pair", repoPath: "/r", environment: { peer: "dev", name: "dev-board" } });
    return { db, d, card, calls };
  }

  it("launches on the peer, journals it with the peer, and refuses a second start", async () => {
    const { db, d, card, calls } = setup(() => Response.json({ ok: true, paneId: "w9:p1", branch: "board/lancer-chez-le-pair", environment: "dev-board" }));
    const r = await startOnPeer(d, card);
    expect(r).toEqual({ ok: true, session: { peer: "dev", environment: "dev-board", paneId: "w9:p1", branch: "board/lancer-chez-le-pair" } });
    expect(calls[0]!.url).toBe("https://dev.example.ts.net/api/node/launch");
    expect(calls[0]!.body).toMatchObject({ environment: "dev-board", branch: "board/lancer-chez-le-pair" });
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(["branch", "environment", "prompt"]);
    expect(db.getCard(card.id)!.status).toBe("working");
    expect(db.openSessionFor(card.id)).toBeNull(); // no local session for reconcile() to orphan
    const again = await startOnPeer(d, db.getCard(card.id)!);
    expect(again).toMatchObject({ ok: false, kind: "board" });
    expect(calls).toHaveLength(1);
  });

  it("journals the peer's refusal and leaves the card where it is", async () => {
    const { db, d, card } = setup(() => Response.json({ ok: false, error: 'autonomy is off for environment "dev-board" on dev — its owner keeps the hand' }, { status: 403 }));
    const r = await startOnPeer(d, card);
    expect(r).toMatchObject({ ok: false, kind: "peer" });
    expect(db.getCard(card.id)!.status).toBe("backlog");
    const failed = db.listEvents(card.id).find((e) => e.type === "card.start_failed")!;
    expect(failed.payload).toMatchObject({ stage: "peer", peer: "dev", environment: "dev-board" });
  });

  it("says the peer is unreachable when it does not answer", async () => {
    const { d, card } = setup(() => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(await startOnPeer(d, card)).toMatchObject({ ok: false, error: "dev-board: dev unreachable (connect ECONNREFUSED)" });
  });

  it("ends the session through the peer", async () => {
    const { db, d, card, calls } = setup((url) => Response.json(url.endsWith("/launch") ? { ok: true, paneId: "w9:p1", branch: "b" } : { ok: true }));
    await startOnPeer(d, card);
    expect(await endOnPeer(d, db.getCard(card.id)!)).toMatchObject({ ok: true });
    expect(calls[1]).toEqual({ url: "https://dev.example.ts.net/api/node/end", body: { paneId: "w9:p1" } });
    expect(remoteSessionOf(db.listEvents(card.id))).toBeNull();
  });

  it("still finds the session, and ends it, after more than 100 events since the launch", async () => {
    const { db, d, card, calls } = setup((url) => Response.json(url.endsWith("/launch") ? { ok: true, paneId: "w9:p1", branch: "b" } : { ok: true }));
    await startOnPeer(d, card);
    for (let i = 0; i < 150; i++) db.recordEvent(card.id, "card.edited", { i });
    expect(remoteSessionOf(db.listEvents(card.id))).toBeNull(); // the capped window has lost it
    expect(remoteSessionFor(db, card.id)).toEqual({ peer: "dev", environment: "dev-board", paneId: "w9:p1", branch: "b" });
    expect(await endOnPeer(d, db.getCard(card.id)!)).toMatchObject({ ok: true });
    expect(calls[1]).toEqual({ url: "https://dev.example.ts.net/api/node/end", body: { paneId: "w9:p1" } });
    expect(remoteSessionFor(db, card.id)).toBeNull();
  });
});

describe("environmentChangeRefusal", () => {
  const DEV_BOARD = { peer: "dev", name: "dev-board" };
  it("lets a card that runs nowhere move, and lets any card keep where it is", () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "x", repoPath: "/r" });
    expect(environmentChangeRefusal(db, card, DEV_BOARD)).toBeNull();
    db.openSession({ cardId: card.id, paneId: "w1:p1" });
    expect(environmentChangeRefusal(db, card, null)).toBeNull();
  });
  it("refuses while a session runs here", () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "x", repoPath: "/r" });
    db.openSession({ cardId: card.id, paneId: "w1:p1" });
    expect(environmentChangeRefusal(db, card, DEV_BOARD)).toContain("running on this machine");
  });
  it("refuses while a session runs on the peer, and not once it has ended", () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "x", repoPath: "/r", environment: DEV_BOARD });
    const s = { peer: "dev", environment: "dev-board", paneId: "w9:p1", branch: "b" };
    db.recordEvent(card.id, "card.remote_launched", s);
    expect(environmentChangeRefusal(db, card, null)).toContain("running on dev (dev-board)");
    expect(environmentChangeRefusal(db, card, { peer: "dev", name: "other" })).not.toBeNull();
    db.recordEvent(card.id, "card.remote_ended", s);
    expect(environmentChangeRefusal(db, card, null)).toBeNull();
  });
});
