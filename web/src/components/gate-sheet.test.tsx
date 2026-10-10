import { act, fireEvent, render, screen } from "@testing-library/react";
import { setPreference } from "@/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GateSheet } from "./gate-sheet";
import type { GateSuggestion } from "@/lib/board";

const setRepoGate = vi.fn(async (_p: string, _g: string | null) => ({ ok: true as const }));
const suggestRepoGate = vi.fn<(p: string) => Promise<{ ok: true; suggestion: GateSuggestion }>>();

vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  setRepoGate: (p: string, g: string | null) => setRepoGate(p, g),
  suggestRepoGate: (p: string) => suggestRepoGate(p),
}));

const field = () => screen.getByRole("textbox") as HTMLInputElement;
const click = (name: RegExp | string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  setRepoGate.mockClear();
  suggestRepoGate.mockReset();
});

// The texts asserted here are in one language, whatever the browser says.
beforeEach(() => setPreference("fr"));
afterEach(() => setPreference("en"));

describe("GateSheet (ADR 0020)", () => {
  it("saves what is typed, whitespace normalised, then closes and tells the caller", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<GateSheet open onClose={onClose} repoPath="/r/app" onSaved={onSaved} />);
    fireEvent.change(field(), { target: { value: "  make   check " } });
    await click("Enregistrer");
    expect(setRepoGate).toHaveBeenCalledWith("/r/app", "make check");
    expect(onSaved).toHaveBeenCalledWith("make check");
    expect(onClose).toHaveBeenCalled();
  });

  it("cannot save an empty command, and only offers Retirer when a gate exists", () => {
    const { rerender } = render(<GateSheet open onClose={() => {}} repoPath="/r/app" />);
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retirer" })).toBeNull();
    rerender(<GateSheet open onClose={() => {}} repoPath="/r/app" gate="make test" />);
    expect(field().value).toBe("make test");
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  it("Retirer clears the gate with null", async () => {
    const onSaved = vi.fn();
    render(<GateSheet open onClose={() => {}} repoPath="/r/app" gate="make test" onSaved={onSaved} />);
    await click("Retirer");
    expect(setRepoGate).toHaveBeenCalledWith("/r/app", null);
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("the copilot's suggestion fills the field and shows its reason, but saves nothing", async () => {
    suggestRepoGate.mockResolvedValue({
      ok: true,
      suggestion: { command: "bun run test", reason: "package.json scripts.test", needsScript: false, scriptSuggestion: null },
    });
    render(<GateSheet open onClose={() => {}} repoPath="/r/app" />);
    await click(/suggérer/i);
    expect(suggestRepoGate).toHaveBeenCalledWith("/r/app");
    expect(field().value).toBe("bun run test");
    expect(screen.getByText("package.json scripts.test")).toBeInTheDocument();
    expect(setRepoGate).not.toHaveBeenCalled();
  });

  it("a suggestion that needs a script shows the script to create, not a chained command", async () => {
    suggestRepoGate.mockResolvedValue({
      ok: true,
      suggestion: { command: "scripts/gate.sh", reason: "CI runs two steps", needsScript: true, scriptSuggestion: "set -e\nmake lint\nmake test" },
    });
    render(<GateSheet open onClose={() => {}} repoPath="/r/app" />);
    await click(/suggérer/i);
    expect(field().value).toBe("scripts/gate.sh");
    expect(screen.getByText(/make lint/)).toBeInTheDocument();
  });

  it("shows the bridge's refusal instead of failing silently", async () => {
    suggestRepoGate.mockRejectedValue(new Error('/api/repos/gate/suggest → 409 {"error":"the copilot is off (COLLIE_BOARD_COPILOT)"}'));
    render(<GateSheet open onClose={() => {}} repoPath="/r/app" />);
    await click(/suggérer/i);
    expect(await screen.findByRole("alert")).toHaveTextContent("the copilot is off");
    expect(field().value).toBe("");
  });
});
