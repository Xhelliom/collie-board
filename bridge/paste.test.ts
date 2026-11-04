import { describe, expect, test } from "bun:test";
import { asPaste } from "./paste.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { classifyUserText, unwrapPastes } from "./transcript.ts";

const snap = (agent: string, bridge: "connected" | "disconnected" = "connected") =>
  ({ agents: [{ paneId: "p1", agent }], shellPanes: [], workspaces: [], tabs: [], bridge }) as unknown as EngineSnapshot;

describe("asPaste", () => {
  const long = "x".repeat(801);

  test("a long text to Claude is one bracketed paste", () => {
    expect(asPaste(snap("claude"), "p1", long)).toBe(`\u001b[200~${long}\u001b[201~`);
  });

  test("800 characters or fewer stay bare", () => {
    expect(asPaste(snap("claude"), "p1", "x".repeat(800))).toBe("x".repeat(800));
  });

  test("another agent, an unknown pane or a disconnected snapshot stay bare", () => {
    expect(asPaste(snap("codex"), "p1", long)).toBe(long);
    expect(asPaste(snap("claude"), "p2", long)).toBe(long);
    expect(asPaste(snap("claude", "disconnected"), "p1", long)).toBe(long);
    expect(asPaste(undefined, "p1", long)).toBe(long);
  });

  test("an end marker inside the text cannot close the paste early; newlines and tabs stay", () => {
    const out = asPaste(snap("claude"), "p1", `a\n\tb\u001b[201~c${long}`);
    expect(out).toBe(`\u001b[200~a\n\tb[201~c${long}\u001b[201~`);
  });
});

describe("unwrapPastes", () => {
  test("drops Claude Code's paste tags, keeps what was pasted", () => {
    const row = '\n\n<pasted_content id="7b22">\nligne 1\nligne 2\n</pasted_content id="7b22">\n\n';
    expect(unwrapPastes(row)).toBe("ligne 1\nligne 2");
    expect(classifyUserText(`avant${row}`)).toEqual({ role: "user", text: "avant\n\nligne 1\nligne 2" });
  });

  test("an unclosed tag and plain text are left alone", () => {
    expect(unwrapPastes('<pasted_content id="ab">\nx')).toBe('<pasted_content id="ab">\nx');
    expect(unwrapPastes(" plain ")).toBe(" plain ");
  });
});
