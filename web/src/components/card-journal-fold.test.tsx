import { render, screen } from "@testing-library/react";
import { CardJournal } from "./card-journal";
import type { BoardEvent } from "@/lib/board";

it("folds a long lead reason in the journal", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
  const e = { id: 1, ts: 1, type: "run.decision", payload: { decision: "finished", reason: "x".repeat(900) } } as unknown as BoardEvent;
  render(<CardJournal events={[e]} onRestore={async () => {}} />);
  expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute("aria-expanded", "false");
  vi.restoreAllMocks();
});
