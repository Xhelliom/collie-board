import { render, screen } from "@testing-library/react";

import type { CardView, Lot } from "@/lib/board";
import { PhaseLots } from "./project-lots";

// Two cards of a parallel lot citing the same file: the lot says so, with the way out. Nothing otherwise.
const cards = ["a", "b"].map((id) => ({ id, title: `step ${id}`, status: "ready", repoPath: "/r" }) as CardView);
const lot = (over: Partial<Lot> = {}): Lot => ({ id: "l1", repoPath: "/r", phaseId: null, name: "L", position: 0, launchedAt: null, cardIds: ["a", "b"], maxParallel: 2, ...over });
const show = (l: Lot) =>
  render(<PhaseLots lots={[{ lot: l, cards, done: 0 }]} steps={cards} byId={new Map(cards.map((c) => [c.id, c]))} onLaunched={() => {}} renderStep={(s) => <li key={s.id}>{s.title}</li>} />);

it("warns on a lot whose cards cite the same file, and proposes a chain or one at a time", () => {
  show(lot({ overlaps: [{ cardIds: ["a", "b"], files: ["bridge/lot.ts"] }] }));
  expect(screen.getByRole("note")).toHaveTextContent(/« step a » and « step b » cite the same files \(bridge\/lot\.ts\).*Chain them.*one at a time/);
});

it("folds every pair of a lot into one line that opens on the full list", () => {
  show(lot({ overlaps: [{ cardIds: ["a", "b"], files: ["x.ts"] }, { cardIds: ["b", "a"], files: ["y.ts"] }] }));
  const note = screen.getByRole("note");
  expect(note.tagName).toBe("DETAILS");
  expect(note).not.toHaveAttribute("open");
  expect(note.querySelector("summary")).toHaveTextContent("2 pairs of cards may conflict");
  expect(note.querySelectorAll("li")).toHaveLength(2);
});

it("shows nothing without an overlap", () => {
  show(lot({ overlaps: [] }));
  expect(screen.queryByRole("note")).toBeNull();
});
