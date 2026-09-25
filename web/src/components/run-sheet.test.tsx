import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunSheet } from "./run-sheet";
import type { CardView } from "@/lib/board";

vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  fetchBoardPrefs: async () => ({ autoFollowUps: false, followUpCategories: [], maxAgents: 3, autoHandoff: false }),
}));

const card = (id: string, dependsOn: string | null = null) =>
  ({ id, title: id, dependsOn, repoPath: "/repo", status: "backlog" }) as CardView;

describe("RunSheet — what the gesture consents to, before it is given", () => {
  it("shows the order, the parallelism, the fold-in cap and the lead's agent, then confirms them", async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <RunSheet
        open
        onClose={() => {}}
        // Charlie waits on Bravo, Bravo on Alpha; Delta waits on a card outside the set, so it runs first.
        cards={[card("Charlie", "Bravo"), card("Alpha"), card("Bravo", "Alpha"), card("Delta", "outside")]}
        repoPath="/home/me/repo"
        onConfirm={onConfirm}
      />,
    );

    const order = within(screen.getByRole("region", { name: "Ordre" }));
    expect(order.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1.Alpha · Delta",
      "2.Bravo",
      "3.Charlie",
    ]);
    expect(await screen.findByText("jusqu'à 3 agents à la fois")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /codex/i }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Lancer le run" })));
    expect(onConfirm).toHaveBeenCalledWith({ foldInCap: 5, leadAgent: "codex" });
  });
});
