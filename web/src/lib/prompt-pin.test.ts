import { pinFor } from "./prompt-pin";
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
