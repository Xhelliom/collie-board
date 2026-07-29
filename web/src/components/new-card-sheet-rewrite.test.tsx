import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewCardSheet } from "./new-card-sheet";

// The "keep my wording" toggle. Worth a component test rather than a unit one: the guarantee the
// user cares about is a property of the REQUEST BODY — no rawInput means the bridge never starts a
// reformulation (board-routes.ts gates on exactly that field) — and only rendering proves the
// toggle is actually wired to it.

async function fill(text: string) {
  const onCreate = vi.fn();
  render(<NewCardSheet open onClose={() => {}} onCreate={onCreate} />);
  await userEvent.type(screen.getByRole("textbox", { name: /what needs doing/i }), text);
  return onCreate;
}

describe("NewCardSheet — the no-rewrite toggle", () => {
  it("sends the dump as rawInput by default, which is what asks for a rewrite", async () => {
    const onCreate = await fill("dicte moi ca");
    await userEvent.click(screen.getByRole("button", { name: /add to backlog/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ rawInput: "dicte moi ca", spec: "dicte moi ca" }),
    );
  });

  it("withholds rawInput once toggled off — the card arrives as a spec, not a dump", async () => {
    const onCreate = await fill("une formulation deja exacte");
    await userEvent.click(screen.getByRole("button", { name: /the copilot will rewrite this/i }));
    await userEvent.click(screen.getByRole("button", { name: /add to backlog/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ rawInput: null, spec: "une formulation deja exacte" }),
    );
  });

  it("still keeps the text as the spec, so the card is never left empty", async () => {
    const onCreate = await fill("le texte");
    await userEvent.click(screen.getByRole("button", { name: /the copilot will rewrite this/i }));
    await userEvent.click(screen.getByRole("button", { name: /add to backlog/i }));

    expect(onCreate.mock.calls[0]![0].spec).toBe("le texte");
    expect(onCreate.mock.calls[0]![0].title).toBe("le texte");
  });

  it("starts on again for the next card — it describes one card, not a preference", async () => {
    const onCreate = vi.fn();
    const { rerender } = render(<NewCardSheet open onClose={() => {}} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /the copilot will rewrite this/i }));
    expect(screen.getByRole("button", { name: /keep my wording/i })).toBeInTheDocument();

    rerender(<NewCardSheet open={false} onClose={() => {}} onCreate={onCreate} />);
    rerender(<NewCardSheet open onClose={() => {}} onCreate={onCreate} />);

    expect(screen.getByRole("button", { name: /the copilot will rewrite this/i })).toBeInTheDocument();
  });
});
