import { render, screen } from "@testing-library/react";
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
afterEach(() => {
  setPreference("en");
  vi.restoreAllMocks();
});

it("folds a long roadmap item detail", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(3000);
  render(
    <MemoryRouter>
      <ProjectRoadmap repo="/r" roadmap={roadmap} />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("button", { name: "Voir plus" }).length).toBeGreaterThan(0);
});
