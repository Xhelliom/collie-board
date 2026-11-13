import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { ReadOnlyBanner } from "./read-only-banner";
import { AgentsPageView } from "./agents-page";

afterEach(() => setPreference("en"));

const overview = () =>
  render(<AgentsPageView herd={[]} internal={new Set()} machineCount={1} onOpen={() => {}} onNew={() => {}} />);

describe("spaces screens speak the chosen language", () => {
  it("empty overview: English by default, French on demand", () => {
    overview();
    expect(screen.getByText("No agent or terminal yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
  });

  it("empty overview in French has no English left", () => {
    setPreference("fr");
    overview();
    expect(screen.getByText("Aucun agent ni terminal pour l'instant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouvel agent" })).toBeInTheDocument();
    expect(screen.queryByText("No agent or terminal yet.")).toBeNull();
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
