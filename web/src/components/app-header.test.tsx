import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppHeader } from "./app-header";
import { StatusBadge } from "./status-badge";

describe("AppHeader — the contextual toolbar", () => {
  it("shows a title and subtitle, no back chevron, on a root screen", () => {
    render(<AppHeader title="Board" subtitle="12 cards" />);
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("12 cards")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("shows a back chevron on an entered screen and calls onBack when tapped", async () => {
    const onBack = vi.fn();
    render(<AppHeader title="Card" onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("children override the title/subtitle block entirely (a bespoke breadcrumb)", () => {
    render(
      <AppHeader title="ignored" subtitle="ignored too">
        <span>webapp › main</span>
      </AppHeader>,
    );
    expect(screen.getByText("webapp › main")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("renders the right cluster (lead then trail) in order", () => {
    render(
      <AppHeader
        title="Pane"
        rightLead={<StatusBadge status="working" />}
        rightTrail={<button type="button">Éditer</button>}
      />,
    );
    expect(screen.getByText("working")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Éditer" })).toBeInTheDocument();
  });

  it("the override takes over the whole row (title and back chevron yield)", () => {
    render(<AppHeader title="Pane" onBack={() => {}} override={<div>FINDBAR</div>} />);
    expect(screen.getByText("FINDBAR")).toBeInTheDocument();
    expect(screen.queryByText("Pane")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
