import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { server } from "@/test/setup";

import { GoalPanel } from "./goal-panel";

const mount = () =>
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <GoalPanel repo="/r" titleOf={() => "Step one"} /> }])} />);

beforeEach(() => setPreference("en"));

describe("GoalPanel", () => {
  it("sets an objective with criteria and budget, then shows what it spent", async () => {
    let sent: unknown = null;
    server.use(
      http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
      http.post("*/api/goals", async ({ request }) => {
        sent = await request.json();
        const b = sent as { text: string; criteria: string[]; budget: unknown };
        return HttpResponse.json({ goal: { id: "g1", repoPath: "/r", ...b, status: "active", createdAt: 1, endedAt: null, spent: { lots: 1, lotIds: ["l1"], cardIds: ["c1"], quotaPct: 30 } } }, { status: 201 });
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Set the objective" }));
    await userEvent.type(screen.getByLabelText("What to reach"), "Ship v1");
    await userEvent.type(screen.getByLabelText("Success criteria — one per line"), "CI green{enter}docs written");
    const lots = screen.getByLabelText("Lots at most");
    await userEvent.clear(lots);
    await userEvent.type(lots, "4");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(sent).toEqual({ repoPath: "/r", text: "Ship v1", criteria: ["CI green", "docs written"], budget: { maxLots: 4, quotaPct: 80, deadline: null } });
    expect(await screen.findByText("Ship v1")).toBeInTheDocument();
    expect(screen.getByText("Lots 1 / 4")).toBeInTheDocument();
    expect(screen.getByText("Quota 30 / 80 %")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Step one" })).toBeInTheDocument();
  });

  it("offers to validate a claimed objective", async () => {
    server.use(
      http.get("*/api/goals", () =>
        HttpResponse.json({ goals: [{ id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, status: "claimed", createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null } }] }),
      ),
    );
    mount();
    expect(await screen.findByText(/says the objective is reached/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate reached" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows progress, budget used and the journal of lot reports and checkpoints", async () => {
    server.use(
      http.get("*/api/goals", () =>
        HttpResponse.json({
          goals: [
            {
              id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, status: "active", createdAt: 1, endedAt: null,
              spent: { lots: 5, lotIds: [], cardIds: [], quotaPct: 20 },
              progress: { lotsDone: 4, cardsDone: 9, cardsBlocked: 1, recettes: 2 },
              journal: [
                { ts: 2, type: "goal.checkpoint", reason: "half", message: "5/10 lots · 9 cartes mergées" },
                { ts: 1, type: "goal.journal", reason: null, message: "Lot A merged" },
              ],
            },
          ],
        }),
      ),
    );
    mount();
    expect(await screen.findByText("Budget 50 % used")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("9 cards merged")).toBeInTheDocument();
    expect(screen.getByText("1 blocked")).toBeInTheDocument();
    expect(screen.getByText("2 to test by hand")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint — half the budget")).toBeInTheDocument();
    expect(screen.getByText("Lot report")).toBeInTheDocument();
    expect(screen.getByText("Lot A merged")).toBeInTheDocument();
  });
});
