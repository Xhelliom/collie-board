import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setPreference } from "@/i18n";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Roadmap } from "@/lib/board";
import { ProjectRoadmap } from "./project-roadmap";

const roadmap = {
  repoPath: "/r",
  vision: "v",
  revision: 1,
  items: [{ id: "p1", name: "Phase", goal: "g", status: "active", detail: "long détail" }],
} as unknown as Roadmap;

beforeEach(() => setPreference("en"));
// The roadmap's fold is remembered per device: one test opening it must not open the next one's.
beforeEach(() => localStorage.clear());
afterEach(() => {
  setPreference("en");
  vi.restoreAllMocks();
});

it("folds a long roadmap item detail", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(3000);
  render(
    <MemoryRouter>
      <ProjectRoadmap repo="/r" roadmap={roadmap} />
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Roadmap1" }));
  expect(screen.getAllByRole("button", { name: "Show more" }).length).toBeGreaterThan(0);
});

it("keeps open and phase-less decisions in clear, the phase-filed ones behind a count", async () => {
  const r = {
    ...roadmap,
    decisions: [
      { id: "d1", text: "ouverte", status: "open", itemId: "p1" },
      { id: "d2", text: "libre", status: "decided", itemId: null },
      { id: "d3", text: "rangée", status: "decided", itemId: "p1" },
      { id: "d4", text: "penchée", status: "leaning", itemId: "p1" },
    ],
  } as unknown as Roadmap;
  render(
    <MemoryRouter>
      <ProjectRoadmap repo="/r" roadmap={r} />
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /^Roadmap/, expanded: false }));
  const journal = screen.getByLabelText("Decision journal");
  expect(within(journal).getByText(/ouverte/)).toBeInTheDocument();
  expect(within(journal).getByText(/libre/)).toBeInTheDocument();
  expect(within(journal).queryByText(/rangée/)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Show 2 more" }));
  expect(within(journal).getByText(/rangée/)).toBeInTheDocument();
  expect(within(journal).getByText(/penchée/)).toBeInTheDocument();
});
