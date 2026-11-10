import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AskUserQuestion as Claude Code 2.1.322 draws it (fixtures claude--v2322-*.txt, captured from a real
// pane): the whole question, the "Type something." row, and the recipe that answers it.
vi.mock("@/lib/api", () => ({ fetchPane: vi.fn(), sendKeys: vi.fn(), sendReply: vi.fn() }));

import { fetchPane, sendKeys, sendReply } from "@/lib/api";
import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";
import { detectPromptSelect } from "@/lib/harness/claude/prompt-select";
import { detectWizard } from "@/lib/harness/claude/wizard";
import { claudeBuildBlocks } from "@/lib/harness/claude";
import { submitFreeText } from "@/lib/free-text-action";
import { BLOCKED_TAIL_ROWS, screenTail } from "@/components/blocked-screen-banner";
import { PromptSelectBlock } from "@/components/prompt-select-block";

const text = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "panes", `claude--v2322-${name}.txt`), "utf8");
const lines = (name: string) => splitLines(parseAnsi(text(name)));
const pane = (name: string) => ({ text: text(name), revision: 0 }) as Awaited<ReturnType<typeof fetchPane>>;

const LONG =
  "The migration touches the billing tables, the notification queue and the public API at the same time, and a rollback after the first write is expensive. Considering that the staging run finished with two flaky tests and that the on-call engineer is only available until 18:00, which rollout strategy do you want me to follow for tonight's release?";

describe("the question is read whole", () => {
  it("a long question wrapped behind the │ gutter, with 4 described choices", () => {
    const m = detectPromptSelect(lines("select-long"))!;
    expect(m.question).toBe(LONG);
    expect(m.options.map((o) => o.label)).toEqual([
      "Canary first",
      "Blue/green switch",
      "Feature flag only",
      "Postpone to Monday",
      "Chat about this",
    ]);
    expect(m.options.slice(0, 4).every((o) => o.description)).toBe(true);
    expect(m.freeText).toEqual({ n: 5, pointed: false });
  });

  it("a short one-line question is unchanged", () => {
    const m = detectPromptSelect(lines("select-short"))!;
    expect(m.question).toBe("Which color theme?");
    expect(m.freeText).toEqual({ n: 3, pointed: false });
  });

  it("two paragraphs behind one gutter: both are kept", () => {
    expect(detectPromptSelect(lines("select-paragraphs"))!.question).toBe(
      "The refactor can stop at the parser or go all the way to the renderer. How far should I go?",
    );
  });

  it("a wizard step: no gutter glyph in the question, and its free-text row", () => {
    const m = detectWizard(lines("wizard-long-q1"))!;
    expect(m.phase === "question" && m.question).toBe(LONG);
    expect(m.phase === "question" && m.freeText).toEqual({ n: 5, pointed: false });
  });

  it("the pointer on the row is read; a row someone typed into is an ordinary option again", () => {
    expect(detectPromptSelect(lines("select-long-freetext"))!.freeText).toEqual({ n: 5, pointed: true });
    const typed = detectPromptSelect(lines("select-long-typing"))!;
    expect(typed.freeText).toBeUndefined();
    expect(typed.options.map((o) => o.label)).toContain("hi");
  });
});

describe("fail-closed is unchanged", () => {
  it("a dialog no grammar recognises stays raw (footer reworded)", () => {
    const unknown = splitLines(parseAnsi(text("select-long").replace("Enter to select", "Return to pick")));
    expect(claudeBuildBlocks(unknown).every((b) => b.kind === "raw")).toBe(true);
  });

  it("…and the banner then shows it from its top border, question included", () => {
    const tail = screenTail(text("select-long").replace("Enter to select", "Return to pick"));
    expect(tail.split("\n").length).toBeGreaterThan(BLOCKED_TAIL_ROWS);
    expect(tail).toContain("☐ Deploy plan");
    expect(tail).toContain("The migration touches the billing tables");
    expect(tail).toContain("5. Type something.");
    expect(tail).not.toContain("<hc from"); // nothing above the dialog
  });

  it("the banner keeps its 14 rows when no border is in reach", () => {
    const body = Array.from({ length: 60 }, (_, i) => `row ${i}`).join("\n");
    expect(screenTail(body).split("\n")).toHaveLength(BLOCKED_TAIL_ROWS);
  });
});

describe("submitFreeText — digit, verified pointer, then the text with its Enter", () => {
  const args = { paneId: "p1", requestedLines: 0, detectedRevision: 0, sleep: async () => {} };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(sendKeys).mockResolvedValue({ ok: true });
    vi.mocked(sendReply).mockResolvedValue({ ok: true });
  });

  it("points the row, then types and submits (forced: the pane is blocked on this dialog)", async () => {
    vi.mocked(fetchPane).mockResolvedValueOnce(pane("select-long")).mockResolvedValue(pane("select-long-freetext"));
    const model = detectPromptSelect(lines("select-long"))!;
    expect(await submitFreeText({ ...args, model, text: "  canary\nat 5 %  " })).toEqual({ status: "sent" });
    expect(sendKeys).toHaveBeenCalledExactlyOnceWith("p1", ["5"], undefined);
    expect(sendReply).toHaveBeenCalledExactlyOnceWith("p1", "canary at 5 %", true, undefined, true);
  });

  it("a row already pointed gets no digit — it would be typed into the answer", async () => {
    vi.mocked(fetchPane).mockResolvedValue(pane("select-long-freetext"));
    const model = detectPromptSelect(lines("select-long-freetext"))!;
    expect(await submitFreeText({ ...args, model, text: "ok" })).toEqual({ status: "sent" });
    expect(sendKeys).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledOnce();
  });

  it("types nothing when the dialog changed, or when the pointer never reaches the row", async () => {
    const model = detectPromptSelect(lines("select-long"))!;
    vi.mocked(fetchPane).mockResolvedValue(pane("select-short"));
    expect(await submitFreeText({ ...args, model, text: "ok" })).toEqual({ status: "changed" });
    expect(sendKeys).not.toHaveBeenCalled();

    vi.mocked(fetchPane).mockResolvedValue(pane("select-long")); // the digit never moved the pointer
    expect(await submitFreeText({ ...args, model, text: "ok" })).toEqual({ status: "changed" });
    expect(sendReply).not.toHaveBeenCalled();
  });
});

describe("the free-text row in the dialog card", () => {
  it("sits above « Chat about this » and hands over what was typed", async () => {
    const onFreeText = vi.fn();
    render(<PromptSelectBlock prompt={detectPromptSelect(lines("select-long"))!} onAction={vi.fn()} onFreeText={onFreeText} />);
    const input = screen.getByRole("textbox");
    const chat = screen.getByRole("button", { name: /Chat about this/ });
    expect(input.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(input, "canary at 5 %{Enter}");
    expect(onFreeText).toHaveBeenCalledExactlyOnceWith("canary at 5 %");
  });
});
