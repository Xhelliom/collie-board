import { describe, expect, it } from "bun:test";

import { paneReason } from "./cards.ts";
import { BoardDb } from "./db.ts";
import { IDLE_LANDING_MS, IdleLanding } from "./idle-landing.ts";

const snap = (status: string) =>
  ({ bridge: "connected", agents: [{ paneId: "w1:p1", status }] }) as never;

function setup(cardStatus: "working" | "blocked" = "working") {
  let t = 1_000_000;
  const db = new BoardDb(":memory:", () => t);
  const card = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
  db.openSession({ cardId: card.id, paneId: "w1:p1" });
  db.setStatus(card.id, cardStatus, "test");
  const il = new IdleLanding(db, () => t);
  return {
    db,
    card,
    at: (ms: number) => ((t += ms), t),
    feed: (status: string, ms = 0) => ((t += ms), il.update(snap(status))),
    status: () => db.getCard(card.id)!.status,
  };
}

describe("IdleLanding (ADR 0037)", () => {
  it("working → idle for more than N s lands the card in review, as `agent done`", () => {
    const s = setup();
    s.feed("working");
    s.feed("idle");
    s.feed("idle", IDLE_LANDING_MS - 1);
    expect(s.status()).toBe("working");
    s.feed("idle", 2);
    expect(s.status()).toBe("review");
    expect(s.db.listEvents(s.card.id).find((e) => e.type === "card.status")?.payload).toMatchObject({ reason: paneReason("done") });
  });

  it("idle never preceded by working (a start) leaves the card in working", () => {
    const s = setup();
    s.feed("idle");
    s.feed("idle", IDLE_LANDING_MS * 10);
    expect(s.status()).toBe("working");
  });

  it("an idle shorter than N s does nothing", () => {
    const s = setup();
    s.feed("working");
    s.feed("idle", 1_000);
    s.feed("working", 1_000);
    s.feed("idle", 1_000);
    s.feed("idle", IDLE_LANDING_MS - 5_000);
    expect(s.status()).toBe("working");
  });

  it("a new prompt resets the detection", () => {
    const s = setup();
    s.feed("working", 10);
    s.feed("idle", 10);
    s.at(10);
    s.db.recordEvent(s.card.id, "card.prompted", { chars: 1 });
    s.feed("idle", IDLE_LANDING_MS + 1_000);
    expect(s.status()).toBe("working");
  });

  it("blocked wins over idle", () => {
    const s = setup("blocked");
    s.feed("working");
    s.feed("blocked", 1_000);
    s.feed("blocked", IDLE_LANDING_MS * 2);
    expect(s.status()).toBe("blocked");
  });

  it("ignores a disconnected snapshot", () => {
    const s = setup();
    s.feed("working");
    s.feed("idle");
    new IdleLanding(s.db).update({ bridge: "disconnected", agents: [] } as never);
    expect(s.status()).toBe("working");
  });
});
