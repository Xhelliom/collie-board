// @vitest-environment node
import { pinFor, topTurn, TOP_HYSTERESIS as H } from "./prompt-pin";
import type { TranscriptEntry } from "./types";

const e = (uuid: string, role: TranscriptEntry["role"], text?: string): TranscriptEntry => ({
  uuid,
  ts: "2026-11-05T10:00:00Z",
  role,
  parts: text === undefined ? [{ kind: "tool", name: "Read", summary: "x" }] : [{ kind: "text", text }],
});

const thread = [
  e("a0", "assistant", "earlier answer"),
  e("u1", "user", "fix the bug"),
  e("a1", "assistant"),
  e("a2", "assistant", "done"),
  e("u2", "user"), // an image alone: no words, not a prompt to pin
  e("a3", "assistant", "next"),
];

describe("pinFor", () => {
  it.each([
    ["a2", "u1"], // a long answer: its prompt is pinned
    ["a1", "u1"],
    ["a3", "u1"], // a wordless user turn is skipped
  ])("top %s pins %s", (top, want) => {
    expect(pinFor(thread, top)?.uuid).toBe(want);
  });

  it.each([
    ["u1"], // the prompt itself is on screen
    ["a0"], // no prompt held above
    [null],
    ["gone"],
  ])("top %s pins nothing", (top) => {
    expect(pinFor(thread, top)).toBeNull();
  });

  it("joins a prompt's text parts", () => {
    const multi = { ...e("u", "user"), parts: [{ kind: "text" as const, text: "a" }, { kind: "text" as const, text: "b" }] };
    expect(pinFor([multi, e("a", "assistant")], "a")?.text).toBe("a\n\nb");
  });
});

// The turn at the edge decides the pin. It used to be "the last turn whose top is above the edge":
// a scroll that jittered a pixel around the edge swapped the turn, hence the pin, back and forth.
describe("topTurn", () => {
  const EDGE = 60; // the pin slot's bottom
  // A prompt and its answer; `y` is how far the answer's top sits from the edge.
  const at = (y: number) => [
    { uuid: "u1", top: EDGE + y - 80 },
    { uuid: "a1", top: EDGE + y },
  ];

  it("measures one turn per position, whichever turn held the top before", () => {
    for (let y = -3 * H; y <= 3 * H; y += 0.25) {
      for (const before of ["u1", "a1", null]) {
        const once = topTurn(at(y), EDGE, before);
        // Re-measuring the same position with its own answer as the holder gives it back: no swap.
        expect(topTurn(at(y), EDGE, once)).toBe(once);
      }
    }
  });

  it("does not swap on a jitter smaller than the dead band", () => {
    let held: string | null = "u1";
    for (const y of [1, -1, 0.5, -2, 3, -H + 1, H - 1]) held = topTurn(at(y), EDGE, held);
    expect(held).toBe("u1");
    held = "a1";
    for (const y of [-1, 1, -0.5, 2, -3, H - 1, -H + 1]) held = topTurn(at(y), EDGE, held);
    expect(held).toBe("a1");
  });

  it("swaps once the turn has crossed the band", () => {
    expect(topTurn(at(-H), EDGE, "u1")).toBe("a1");
    expect(topTurn(at(H + 1), EDGE, "a1")).toBe("u1");
  });

  it("is null above the first turn", () => {
    expect(topTurn(at(200), EDGE, null)).toBeNull();
  });
});
