import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The shared board's journal, its pure core (ADR 0048 §2, lot 1): who this installation is (pairId),
// the hybrid clock that orders its writes, the format of one event line, and the last-writer-per-field
// projection of an entity's events. Nothing here touches git, the network or db.ts yet; the only I/O
// is `loadPairId`, the one file that makes an installation the same writer across restarts.

const PAIR_ID_RE = /^[0-9a-f]{12}$/;
const PAIR_ID_FILE = "pair-id";

/**
 * This installation's stable id: drawn on first launch, kept at `<stateDir>/pair-id` (0600), never in
 * a repo. It names the writer's own journal files and breaks ties between simultaneous events.
 */
export function loadPairId(stateDir: string): string {
  const path = join(stateDir, PAIR_ID_FILE);
  try {
    writeFileSync(path, randomBytes(6).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const id = readFileSync(path, "utf8").trim();
  // A mangled id is not redrawn: a new one would silently become a second writer.
  if (!PAIR_ID_RE.test(id)) throw new Error(`${path}: not a pair id`);
  return id;
}

// `<ms, 13 digits>.<counter, 4 digits>.<pairId>`: fixed widths, so string order IS clock order.
const HLC_RE = /^(\d{13})\.(\d{4})\.([0-9a-f]{12})$/;
const MAX_COUNTER = 9999;

export interface HlcParts {
  ms: number;
  counter: number;
  pairId: string;
}

export function formatHlc({ ms, counter, pairId }: HlcParts): string {
  return `${String(ms).padStart(13, "0")}.${String(counter).padStart(4, "0")}.${pairId}`;
}

export function parseHlc(s: string): HlcParts | null {
  const m = HLC_RE.exec(s);
  return m ? { ms: Number(m[1]), counter: Number(m[2]), pairId: m[3]! } : null;
}

/**
 * A hybrid logical clock. `observe` every hlc read from any journal; `next` then stamps a write that
 * sorts after all of them, whatever this machine's wall clock says.
 */
export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly pairId: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!PAIR_ID_RE.test(pairId)) throw new Error(`not a pair id: ${pairId}`);
  }

  observe(hlc: string): void {
    const r = parseHlc(hlc);
    if (!r) return;
    if (r.ms > this.ms) {
      this.ms = r.ms;
      this.counter = r.counter;
    } else if (r.ms === this.ms && r.counter > this.counter) {
      this.counter = r.counter;
    }
  }

  next(): string {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter++;
    } else {
      // The counter is full: borrow the next millisecond, still after everything observed.
      this.ms++;
      this.counter = 0;
    }
    return formatHlc({ ms: this.ms, counter: this.counter, pairId: this.pairId });
  }
}

/** One line of a journal file, format v1. The entity is the file's folder, not a field of the line. */
export interface JournalEvent {
  v: 1;
  hlc: string;
  /** `<entity>.set`, `<entity>.deleted`, `card.event`, `card.review`, `card.claimed`, `deliverable.published`. */
  type: string;
  by: string;
  fields: Record<string, unknown>;
}

const TYPE_RE = /^[a-z]+\.[a-z]+$/;
const EVENT_KEYS = ["by", "fields", "hlc", "type", "v"];

export function formatEvent(e: JournalEvent): string {
  return JSON.stringify({ v: e.v, hlc: e.hlc, type: e.type, by: e.by, fields: e.fields });
}

/** Strict parse of one line: anything off is an error, never a guess. */
export function parseEvent(line: string): { ok: true; event: JournalEvent } | { ok: false; error: string } {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return { ok: false, error: "not an object" };
  const r = o as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== EVENT_KEYS.join()) return { ok: false, error: "unexpected keys" };
  if (r.v !== 1) return { ok: false, error: "unknown version" };
  if (typeof r.hlc !== "string" || !parseHlc(r.hlc)) return { ok: false, error: "bad hlc" };
  if (typeof r.type !== "string" || !TYPE_RE.test(r.type)) return { ok: false, error: "bad type" };
  if (typeof r.by !== "string" || r.by === "") return { ok: false, error: "bad by" };
  const f = r.fields;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return { ok: false, error: "bad fields" };
  return { ok: true, event: r as unknown as JournalEvent };
}

/** A whole `.jsonl` file: the valid events, and the invalid lines (1-based) to report — never a throw. */
export function parseJournal(text: string): { events: JournalEvent[]; invalid: { line: number; error: string }[] } {
  const events: JournalEvent[] = [];
  const invalid: { line: number; error: string }[] = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    const r = parseEvent(raw);
    if (r.ok) events.push(r.event);
    else invalid.push({ line: i + 1, error: r.error });
  });
  return { events, invalid };
}

/** An entity as its events make it: each field with the hlc that set it, or a tombstone. */
export interface Projection {
  deleted: boolean;
  fields: Record<string, { value: unknown; hlc: string }>;
}

export function emptyProjection(): Projection {
  return { deleted: false, fields: {} };
}

/**
 * Fold one event into an entity, in place. Commutative and idempotent: any order of the same events
 * gives the same projection. `<entity>.deleted` is final and beats every `.set`, whatever its hlc.
 * Other types (`card.event`, `card.review`, …) carry no fields of the entity and are left to their readers.
 */
export function applyEvent(p: Projection, e: JournalEvent): Projection {
  if (p.deleted) return p;
  if (e.type.endsWith(".deleted")) {
    p.deleted = true;
    p.fields = {};
  } else if (e.type.endsWith(".set")) {
    for (const [field, value] of Object.entries(e.fields)) {
      const cur = p.fields[field];
      if (!cur || e.hlc > cur.hlc) p.fields[field] = { value, hlc: e.hlc };
    }
  }
  return p;
}

export function project(events: JournalEvent[]): Projection {
  return events.reduce(applyEvent, emptyProjection());
}
