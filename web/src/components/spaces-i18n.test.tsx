import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { ReadOnlyBanner } from "./read-only-banner";
import { SpaceOverview } from "./space-overview";

afterEach(() => setPreference("en"));

const overview = () =>
  render(<SpaceOverview workspaces={[]} tabs={[]} agents={[]} shellPanes={[]} onOpen={() => {}} onOpenPane={() => {}} onNewSpace={() => {}} />);

describe("spaces screens speak the chosen language", () => {
  it("empty overview: English by default, French on demand", () => {
    overview();
    expect(screen.getByText("No spaces yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New space" })).toBeInTheDocument();
  });

  it("empty overview in French has no English left", () => {
    setPreference("fr");
    overview();
    expect(screen.getByText("Aucun space pour l'instant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouveau space" })).toBeInTheDocument();
    expect(screen.queryByText("No spaces yet.")).toBeNull();
  });

  it("read-only banner follows the language", () => {
    setPreference("en");
    const { unmount } = render(<ReadOnlyBanner device={{ enforced: true, authorized: false } as never} />);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    unmount();
    setPreference("fr");
    render(<ReadOnlyBanner device={{ enforced: true, authorized: false } as never} />);
    expect(screen.getByText("Lecture seule")).toBeInTheDocument();
  });
});
