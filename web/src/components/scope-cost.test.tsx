import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fetchScopeCost, type ScopeCostData } from "@/lib/board";
import { ScopeCost } from "./scope-cost";

vi.mock("@/lib/board", () => ({ fetchScopeCost: vi.fn() }));

const tokens = { input: 100_000, output: 200_000, cacheWrite: 300_000, cacheRead: 600_000 };
const base: ScopeCostData = { known: true, tokens, byModel: [{ model: "m", label: "Opus 5.5", tokens }], cards: 3, unknownCards: 2, orchestrator: null, period: "all" };
const text = () => screen.getByTestId("scope-cost").textContent ?? "";

describe("ScopeCost", () => {
  it("shows the total and says the unknown cards apart", async () => {
    vi.mocked(fetchScopeCost).mockResolvedValue(base);
    render(<ScopeCost repo="/r" runId="l" />);
    await waitFor(() => expect(text()).toMatch(/1[,.]2 M/));
    expect(text()).toMatch(/\+ 2 cartes inconnues|\+ 2 unknown cards/);
  });
  it("says unknown, never 0, when no card has a figure", async () => {
    vi.mocked(fetchScopeCost).mockResolvedValue({ ...base, known: false, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, byModel: [], unknownCards: 2 });
    render(<ScopeCost repo="/r" phaseId="p" />);
    await waitFor(() => expect(text()).toMatch(/inconnu|unknown/));
    expect(text()).not.toMatch(/\b0 tokens/);
  });
  it("renders nothing for a scope no card ever started in", async () => {
    vi.mocked(fetchScopeCost).mockResolvedValue({ ...base, cards: 0, unknownCards: 0, known: false });
    const { container } = render(<ScopeCost repo="/r" />);
    await waitFor(() => expect(fetchScopeCost).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
