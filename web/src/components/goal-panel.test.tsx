import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { server } from "@/test/setup";

import type { OpenGoal } from "./goal-chip";
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

  it("prepares the next objective while one is open, then validating the current one starts it", async () => {
    const base = { repoPath: "/r", budget: { maxLots: 10, quotaPct: 80, deadline: null }, createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null } };
    const cur = { ...base, id: "g1", text: "Ship v1", criteria: ["CI green"], status: "active" };
    let sent: unknown = null;
    let goals: unknown[] = [cur];
    server.use(
      http.get("*/api/goals", () => HttpResponse.json({ goals })),
      http.post("*/api/goals", async ({ request }) => {
        sent = await request.json();
        const b = sent as { text: string; criteria: string[] };
        return HttpResponse.json({ goal: { ...base, id: "g2", text: b.text, criteria: b.criteria, status: "queued" } }, { status: 201 });
      }),
      http.post("*/api/goals/g1/achieve", () => {
        goals = [{ ...base, id: "g2", text: "Ship v2", criteria: ["users happy"], status: "active" }, { ...cur, status: "achieved" }];
        return HttpResponse.json({ goal: { ...cur, status: "achieved" } });
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Prepare the next one" }));
    await userEvent.type(screen.getByLabelText("What to reach"), "Ship v2");
    await userEvent.type(screen.getByLabelText("Success criteria — one per line"), "users happy");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sent).toMatchObject({ text: "Ship v2", next: true });
    expect(await screen.findByText("Next objective")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Validate reached" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByText("Ship v2")).toBeInTheDocument();
    expect(screen.queryByText("Next objective")).toBeNull();
  });

  it("says when no orchestrator will start an active objective", async () => {
    const g = { id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, status: "active", createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null } };
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [g] })));
    render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <GoalPanel repo="/r" titleOf={() => undefined} noOrchestrator /> }])} />);
    expect(await screen.findByText(/No orchestrator runs for this repo/)).toBeInTheDocument();
  });

  it("offers to validate a claimed objective", async () => {
    server.use(
      http.get("*/api/goals", () =>
        HttpResponse.json({ goals: [{ id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, status: "claimed", createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null }, claim: { ts: 2, proofs: ["CI #42 green"] } }] }),
      ),
    );
    mount();
    expect(await screen.findByText(/says the objective is reached/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate reached" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.getByText("CI #42 green")).toBeInTheDocument(); // the proof, under its criterion
  });

  it("refuses a claimed objective only with a comment, which it sends", async () => {
    let sent: unknown = null;
    const g = { id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null } };
    server.use(
      http.get("*/api/goals", () => HttpResponse.json({ goals: [{ ...g, status: "claimed" }] })),
      http.post("*/api/goals/g1/resume", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ goal: { ...g, status: "active" } });
      }),
    );
    mount();
    const refuse = await screen.findByRole("button", { name: "Refuse and send back to work" });
    expect(refuse).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What is still missing"), "docs");
    await userEvent.click(refuse);
    expect(sent).toEqual({ comment: "docs" });
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
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

  it("lists past objectives newest first, folded by default", async () => {
    const base = { repoPath: "/r", criteria: ["x"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, createdAt: 1, spent: { lotIds: [], cardIds: [], quotaPct: null } };
    server.use(
      http.get("*/api/goals", () =>
        HttpResponse.json({
          goals: [
            { ...base, id: "g2", text: "Older", status: "abandoned", endedAt: 100, spent: { ...base.spent, lots: 1 } },
            { ...base, id: "g3", text: "Newer", status: "achieved", endedAt: 200, spent: { ...base.spent, lots: 3 } },
          ],
        }),
      ),
    );
    mount();
    const summary = await screen.findByText("Past objectives (2)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    const items = summary.closest("details")!.querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([expect.stringMatching(/achieved.*3 lots.*Newer/), expect.stringMatching(/abandoned.*1 lots.*Older/)]);
  });

  it("says goal mode needs nothing more, and hands its status to the page header", async () => {
    const g = { id: "g1", repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: { maxLots: 10, quotaPct: 80, deadline: null }, status: "active", createdAt: 1, endedAt: null, spent: { lots: 0, lotIds: [], cardIds: [], quotaPct: null } };
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [g] })));
    const seen: (OpenGoal | null)[] = [];
    render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <GoalPanel repo="/r" titleOf={() => undefined} onGoal={(g) => seen.push(g)} /> }])} />);
    expect(await screen.findByText(/nothing more to switch on/)).toBeInTheDocument();
    // onGoal fires from a passive effect, which can land after the text is on screen.
    await waitFor(() => expect(seen.at(-1)).toEqual({ status: "active", text: "Ship v1" }));
  });

  it("without an objective, tells the header there is none", async () => {
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [] })));
    const seen: (OpenGoal | null)[] = [];
    render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <GoalPanel repo="/r" titleOf={() => undefined} onGoal={(g) => seen.push(g)} /> }])} />);
    expect(await screen.findByRole("button", { name: "Set the objective" })).toBeInTheDocument();
    expect(seen.every((s) => s === null)).toBe(true);
  });
});
