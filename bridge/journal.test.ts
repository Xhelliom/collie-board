import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatEvent,
  formatHlc,
  Hlc,
  loadPairId,
  parseEvent,
  parseHlc,
  parseJournal,
  project,
  type JournalEvent,
} from "./journal.ts";

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";

function ev(hlc: string, type: string, fields: Record<string, unknown> = {}): JournalEvent {
  return { v: 1, hlc, type, by: "someone@example.com", fields };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("pairId", () => {
  test("drawn once, kept owner-only, the same on every load", () => {
    const dir = mkdtempSync(join(tmpdir(), "journal-"));
    const id = loadPairId(dir);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(loadPairId(dir)).toBe(id);
    expect(statSync(join(dir, "pair-id")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "pair-id"), "utf8").trim()).toBe(id);
  });

  test("a mangled id is refused, not redrawn", () => {
    const dir = mkdtempSync(join(tmpdir(), "journal-"));
    writeFileSync(join(dir, "pair-id"), "nope\n");
    expect(() => loadPairId(dir)).toThrow();
  });
});

describe("Hlc", () => {
  test("string order is clock order", () => {
    const a = formatHlc({ ms: 999, counter: 12, pairId: A });
    const b = formatHlc({ ms: 1000, counter: 0, pairId: A });
    expect(a < b).toBe(true);
    expect(parseHlc(a)).toEqual({ ms: 999, counter: 12, pairId: A });
    expect(parseHlc("1.2.x")).toBeNull();
  });

  test("monotonic even when the wall clock stalls or goes back", () => {
    let wall = 5000;
    const c = new Hlc(A, () => wall);
    const h1 = c.next();
    wall = 4000;
    const h2 = c.next();
    const h3 = c.next();
    expect(h1 < h2 && h2 < h3).toBe(true);
  });

  test("a write made after reading beats a wall clock running ahead", () => {
    // B's clock is three minutes ahead; A answers B's edit one second later, by A's clock.
    const ahead = new Hlc(B, () => 1_000_000 + 180_000);
    const theirs = ahead.next();
    const mine = new Hlc(A, () => 1_001_000);
    mine.observe(theirs);
    const answer = mine.next();
    expect(answer > theirs).toBe(true);
    const p = project([ev(answer, "card.set", { title: "mine" }), ev(theirs, "card.set", { title: "theirs" })]);
    expect(p.fields.title!.value).toBe("mine");
  });

  test("a full counter borrows the next millisecond", () => {
    const c = new Hlc(A, () => 0);
    c.observe(formatHlc({ ms: 7, counter: 9999, pairId: B }));
    const h = c.next();
    expect(parseHlc(h)).toEqual({ ms: 8, counter: 0, pairId: A });
  });
});

describe("parse", () => {
  test("a line round-trips", () => {
    const e = ev(formatHlc({ ms: 1729677600123, counter: 4, pairId: A }), "card.set", { status: "todo" });
    expect(parseEvent(formatEvent(e))).toEqual({ ok: true, event: e });
  });

  test("corrupt lines are skipped and reported, never thrown", () => {
    const good = formatEvent(ev(formatHlc({ ms: 1, counter: 0, pairId: A }), "card.set", { title: "x" }));
    const text = [
      good,
      '{"v":1,"hlc":"1.0.a"', // truncated write
      "",
      good.replace('"v":1', '"v":2'),
      good.replace("card.set", "Card"),
      good.replace('"fields":{"title":"x"}', '"fields":[]'),
      good.slice(0, -1) + ',"extra":1}',
      "[]",
      good,
    ].join("\n");
    const { events, invalid } = parseJournal(text);
    expect(events).toHaveLength(2);
    expect(invalid.map((i) => i.line)).toEqual([2, 4, 5, 6, 7, 8]);
  });
});

describe("projection", () => {
  const h = (ms: number, pairId = A) => formatHlc({ ms, counter: 0, pairId });

  test("any permutation of the events gives the same state", () => {
    const events = [
      ev(h(1), "card.set", { title: "a", status: "todo" }),
      ev(h(2, B), "card.set", { title: "b" }),
      ev(h(2, A), "card.set", { status: "doing" }),
      ev(h(3), "card.event", { kind: "note" }),
      ev(h(4, B), "card.set", { spec: "s" }),
    ];
    const ref = project(events);
    for (const p of permutations(events)) expect(project(p)).toEqual(ref);
    expect(project(events).fields).toEqual({
      title: { value: "b", hlc: h(2, B) },
      status: { value: "doing", hlc: h(2, A) },
      spec: { value: "s", hlc: h(4, B) },
    });
  });

  test("the pairId breaks a tie on the same instant", () => {
    const p = project([ev(h(5, B), "card.set", { title: "b" }), ev(h(5, A), "card.set", { title: "a" })]);
    expect(p.fields.title!.value).toBe("b");
  });

  test("the tombstone is final, whatever comes after", () => {
    const events = [
      ev(h(1), "card.set", { title: "a" }),
      ev(h(2), "card.deleted"),
      ev(h(9, B), "card.set", { title: "late" }),
    ];
    for (const p of permutations(events)) expect(project(p)).toEqual({ deleted: true, fields: {} });
  });
});
