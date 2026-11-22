import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import type { OutboundPeer } from "./pairing.ts";
import { REMOTE_LAUNCHED, remoteSessionFor } from "./remote-launch.ts";
import { RemoteWrapup } from "./remote-wrapup.ts";

const DEV: OutboundPeer = { name: "dev", url: "https://dev.example.ts.net", token: "t".repeat(43), pairedAt: "" };

function setup(answer: () => Response | Promise<Response> = () => Response.json({ ok: true })) {
  const db = new BoardDb(":memory:");
  const ends: unknown[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    ends.push(JSON.parse(init.body as string));
    return answer();
  }) as unknown as typeof fetch;
  const card = db.createCard({ title: "Sur le Dell", repoPath: "/r", environment: { peer: "dev", name: "dev-board" } });
  db.recordEvent(card.id, REMOTE_LAUNCHED, { peer: "dev", environment: "dev-board", paneId: "w9:p1", branch: "board/sur-le-dell" });
  return { db, card, ends, wrapup: new RemoteWrapup({ db, fetch: fetchFn, outbound: () => [DEV] }) };
}

describe("RemoteWrapup", () => {
  it("ends a finished card's session on its peer once, and journals it", async () => {
    const { db, card, ends, wrapup } = setup();
    db.setStatus(card.id, "done", "merged");
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "idle" }]);
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "idle" }]);
    expect(ends).toEqual([{ paneId: "w9:p1", environment: "dev-board", branch: "board/sur-le-dell" }]);
    expect(remoteSessionFor(db, card.id)).toBeNull();
    expect(db.listEvents(card.id).some((e) => e.type === "card.remote_ended")).toBe(true);
  });

  it("leaves a card still running, and a pane still working or blocked", async () => {
    const { db, card, ends, wrapup } = setup();
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "idle" }]);
    db.setStatus(card.id, "archived", "lot");
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "working" }]);
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "blocked" }]);
    await wrapup.seen("other", []);
    expect(ends).toEqual([]);
    await wrapup.seen("dev", [{ paneId: "w9:p1", status: "done" }]);
    expect(ends).toHaveLength(1);
  });

  it("tries again at the next read when the peer fails, and frees the card on a 404", async () => {
    let answer: () => Response = () => Response.json({ ok: false, error: "herdr is not connected" }, { status: 502 });
    const { db, card, ends, wrapup } = setup(() => answer());
    db.setStatus(card.id, "done", "merged");
    await wrapup.seen("dev", []);
    expect(remoteSessionFor(db, card.id)).not.toBeNull();
    answer = () => Response.json({ ok: false, error: "not a pane launched for this peer" }, { status: 404 });
    await wrapup.seen("dev", []);
    expect(ends).toHaveLength(2);
    expect(remoteSessionFor(db, card.id)).toBeNull();
  });
});
