import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { IdleLock } from "@/components/idle-lock";
import { setPreference } from "@/i18n";

afterEach(() => setPreference("en"));

describe("IdleLock", () => {
  it("speaks English by default, French on request — never both", () => {
    const { unmount } = render(<IdleLock onUnlock={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Collie paused" })).toBeInTheDocument();
    expect(screen.getByText("Tap to resume")).toBeInTheDocument();
    unmount();
    setPreference("fr");
    render(<IdleLock onUnlock={() => {}} catchingUp />);
    expect(screen.getByRole("dialog", { name: "Collie en pause" })).toBeInTheDocument();
    expect(screen.getByText("Mise à jour…")).toBeInTheDocument();
  });
});
