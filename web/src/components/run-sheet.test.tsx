import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunSheet } from "./run-sheet";
import type { CardView } from "@/lib/board";

let repoGate: string | undefined;
vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  fetchBoardPrefs: async () => ({ autoFollowUps: false, followUpCategories: [], maxAgents: 3, autoHandoff: false }),
  fetchRepos: async () => ({
    repos: [{ path: "/home/me/repo", name: "repo", source: "card", gate: repoGate }],
    hiddenCount: 0,
  }),
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
        phases={[]}
        phaseId={null}
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

  it("says when the repo has no gate and offers to set one; shows it when it has", async () => {
    repoGate = undefined;
    const { unmount } = render(<RunSheet open onClose={() => {}} cards={[card("A")]} repoPath="/home/me/repo" phases={[]} phaseId={null} onConfirm={async () => {}} />);
    const row = await screen.findByLabelText("Barrière");
    expect(row).toHaveTextContent("aucune");
    fireEvent.click(within(row).getByRole("button", { name: "Régler" }));
    expect(await screen.findByText("Barrière · repo")).toBeInTheDocument();
    unmount();

    repoGate = "tools/ovg gate";
    render(<RunSheet open onClose={() => {}} cards={[card("A")]} repoPath="/home/me/repo" phases={[]} phaseId={null} onConfirm={async () => {}} />);
    const gated = await screen.findByLabelText("Barrière");
    expect(gated).toHaveTextContent("tools/ovg gate");
    expect(within(gated).getByRole("button", { name: "Modifier" })).toBeInTheDocument();
  });

  it("plans a lot under a phase instead of launching it, and only once it has a name", async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <RunSheet
        open
        onClose={() => {}}
        cards={[card("A")]}
        repoPath="/home/me/repo"
        phases={[{ id: "p1", repoPath: "/home/me/repo", name: "Phase un", goal: "", position: 0, roadmapItemId: null }]}
        phaseId="p1"
        onConfirm={onConfirm}
      />,
    );
    const plan = screen.getByRole("button", { name: "Planifier un lot" });
    expect(plan).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Nom du lot"), { target: { value: "Lot A" } });
    await act(async () => void fireEvent.click(plan));
    expect(onConfirm).toHaveBeenCalledWith({ foldInCap: 2, leadAgent: null, planned: true, phaseId: "p1", name: "Lot A" });
  });
});
