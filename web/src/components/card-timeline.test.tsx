import { render, screen, fireEvent } from "@testing-library/react";
import { CardTimeline } from "./card-timeline";
import type { BoardEvent } from "@/lib/board";

const send = (id: number) => ({ id, cardId: "c", ts: id, type: "run.decision", payload: { decision: "prompt", reason: "r" } }) as BoardEvent;

it("opens a folded round-trip milestone on tap", () => {
  render(<CardTimeline events={[send(3), send(2), send(1)]} />);
  const b = screen.getByRole("button");
  expect(b).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(b);
  expect(b).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByText(/Lead sent a follow-up|Le lead a renvoyé/)).toHaveLength(3);
});
