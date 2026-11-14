import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fetchCardCost, type CardCost } from "@/lib/board";
import { CardCostLine, formatTokens } from "./card-cost";

vi.mock("@/lib/board", () => ({ fetchCardCost: vi.fn() }));

const tokens = { input: 100_000, output: 200_000, cacheWrite: 300_000, cacheRead: 600_000 };
const known: CardCost = { tokens, byModel: [{ model: "claude-opus-5-5", label: "Opus 5.5", tokens }], sessions: 2, counted: 2, known: true, partial: false };

describe("CardCostLine", () => {
  it("shows the total and the model, with the per-type detail", async () => {
    vi.mocked(fetchCardCost).mockResolvedValue(known);
    render(<CardCostLine cardId="c" />);
    await waitFor(() => expect(screen.getByTestId("card-cost").textContent).toContain("Opus 5.5"));
    expect(screen.getByTestId("card-cost").textContent).toMatch(/1[,.]2 M/);
    expect(screen.getByTestId("card-cost").textContent).toMatch(/600[\s  ,.]?000/);
  });
  it("says unknown, never 0, for an unverified agent", async () => {
    vi.mocked(fetchCardCost).mockResolvedValue({ ...known, known: false, partial: false, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, byModel: [] });
    render(<CardCostLine cardId="c" />);
    await waitFor(() => expect(screen.getByTestId("card-cost").textContent).toMatch(/inconnu|unknown/));
    expect(screen.getByTestId("card-cost").textContent).not.toMatch(/\b0\b/);
  });
  it("says partial when sessions are missing a figure", async () => {
    vi.mocked(fetchCardCost).mockResolvedValue({ ...known, sessions: 3, counted: 2, partial: true });
    render(<CardCostLine cardId="c" />);
    await waitFor(() => expect(screen.getByTestId("card-cost").textContent).toMatch(/partiel, 2\/3|partial, 2\/3/));
  });
  it("formats", () => expect(formatTokens(1_234_000, "en")).toBe("1.2 M"));
});
