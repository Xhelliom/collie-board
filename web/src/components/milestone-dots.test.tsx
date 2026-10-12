import { render, screen } from "@testing-library/react";
import { MilestoneDots } from "./milestone-dots";
import type { BoardEvent } from "@/lib/board";

const ev = (id: number, type: string, payload: unknown = {}) => ({ id, cardId: "c", type, payload, ts: id }) as BoardEvent;

it("draws one dot per milestone, a red gate and a folded send-back included", () => {
  render(
    <MilestoneDots
      events={[ev(1, "session.opened"), ev(2, "run.decision", { decision: "prompt" }), ev(3, "run.decision", { decision: "prompt" }), ev(4, "run.gate", { ok: false }), ev(5, "card.pr_opened")]}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(4);
  expect(screen.getByRole("img", { name: /Gate red|Gate rouge/ })).toBeTruthy();
  expect(screen.getByRole("img", { name: /2/ })).toBeTruthy();
});

it("renders nothing without milestones", () => {
  const { container } = render(<MilestoneDots events={[ev(1, "card.edited")]} />);
  expect(container).toBeEmptyDOMElement();
});
