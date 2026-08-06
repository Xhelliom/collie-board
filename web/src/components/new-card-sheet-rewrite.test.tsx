import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewCardSheet } from "./new-card-sheet";

// The "keep my wording" toggle. Worth a component test rather than a unit one: the guarantee the
// user cares about is a property of the REQUEST BODY — no rawInput means the bridge never starts a
// reformulation (board-routes.ts gates on exactly that field) — and only rendering proves the
// toggle is actually wired to it.
//
// The toggle is a real Switch since the redesign (ui/switch.tsx) — one fixed label ("Rewrite with
// the copilot"), state exposed as `aria-checked`, not a dynamic accessible name any more.

async function fill(text: string) {
  const onCreate = vi.fn();
  render(<NewCardSheet open onClose={() => {}} onCreate={onCreate} tags={[]} />);
  await userEvent.type(screen.getByRole("textbox", { name: /what needs doing/i }), text);
  return onCreate;
}

function rewriteSwitch() {
  return screen.getByRole("switch", { name: /rewrite with the copilot/i });
}

describe("NewCardSheet — the no-rewrite toggle", () => {
  it("sends the dump as rawInput by default, which is what asks for a rewrite", async () => {
    const onCreate = await fill("dicte moi ca");
    expect(rewriteSwitch()).toHaveAttribute("aria-checked", "true"); // on by default
    await userEvent.click(screen.getByRole("button", { name: /ajouter au backlog/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ rawInput: "dicte moi ca", spec: "dicte moi ca" }),
    );
  });

  it("withholds rawInput once toggled off — the card arrives as a spec, not a dump", async () => {
    const onCreate = await fill("une formulation deja exacte");
    await userEvent.click(rewriteSwitch());
    expect(rewriteSwitch()).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("button", { name: /ajouter au backlog/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ rawInput: null, spec: "une formulation deja exacte" }),
    );
  });

  it("still keeps the text as the spec, so the card is never left empty", async () => {
    const onCreate = await fill("le texte");
    await userEvent.click(rewriteSwitch());
    await userEvent.click(screen.getByRole("button", { name: /ajouter au backlog/i }));

    expect(onCreate.mock.calls[0]![0].spec).toBe("le texte");
    expect(onCreate.mock.calls[0]![0].title).toBe("le texte");
  });

  it("starts on again for the next card — it describes one card, not a preference", async () => {
    const onCreate = vi.fn();
    const { rerender } = render(<NewCardSheet open onClose={() => {}} onCreate={onCreate} tags={[]} />);
    await userEvent.click(rewriteSwitch());
    expect(rewriteSwitch()).toHaveAttribute("aria-checked", "false");

    rerender(<NewCardSheet open={false} onClose={() => {}} onCreate={onCreate} tags={[]} />);
    rerender(<NewCardSheet open onClose={() => {}} onCreate={onCreate} tags={[]} />);

    expect(rewriteSwitch()).toHaveAttribute("aria-checked", "true");
  });
});

// The form is taller than the sheet on a phone: put the confirm button back at the end of the body
// and it opens below the fold, which is exactly what was reported. jsdom lays nothing out, so the
// check is structural — the button must not live inside the panel's scroller.
describe("NewCardSheet — the confirm action stays reachable", () => {
  it("keeps 'Ajouter au backlog' out of the scrolling body", () => {
    render(<NewCardSheet open onClose={() => {}} onCreate={vi.fn()} tags={[]} />);
    const scroller = screen
      .getByRole("textbox", { name: /what needs doing/i })
      .closest(".overflow-y-auto")!;
    const confirm = screen.getByRole("button", { name: /ajouter au backlog/i });

    expect(scroller).not.toBeNull();
    expect(scroller.contains(confirm)).toBe(false);
  });
});
