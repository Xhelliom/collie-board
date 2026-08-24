import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppHeader } from "./app-header";
import { StatusBadge } from "./status-badge";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";

// The header carries the bell, which reads its badge count from the root loader — so a header only
// ever exists inside the data router, and so does every header under test.
function renderHeader(header: ReactElement) {
  const home = { notifyCount: 0 } as HomeData;
  const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => home, element: header }], {
    hydrationData: { loaderData: { [ROOT_ROUTE_ID]: home } },
  });
  return render(<RouterProvider router={router} />);
}

describe("AppHeader — the contextual toolbar", () => {
  it("shows a title and subtitle, no back chevron, on a root screen", () => {
    renderHeader(<AppHeader title="Board" subtitle="12 cards" />);
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("12 cards")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("shows a back chevron on an entered screen and calls onBack when tapped", async () => {
    const onBack = vi.fn();
    renderHeader(<AppHeader title="Card" onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("children override the title/subtitle block entirely (a bespoke breadcrumb)", () => {
    renderHeader(
      <AppHeader title="ignored" subtitle="ignored too">
        <span>webapp › main</span>
      </AppHeader>,
    );
    expect(screen.getByText("webapp › main")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("renders the right cluster lead, then trail, then the bell last", () => {
    renderHeader(
      <AppHeader
        title="Pane"
        rightLead={<StatusBadge status="working" />}
        rightTrail={<button type="button">Éditer</button>}
      />,
    );
    const lead = screen.getByText("working");
    const trail = screen.getByRole("button", { name: "Éditer" });
    const bell = screen.getByRole("button", { name: "Notifications" });
    // The bell is the anchored slot: last in a right-aligned row, so it sits at the same x on every
    // screen whatever lead/trail that screen mounts. This order IS the anchoring.
    // Node.DOCUMENT_POSITION_FOLLOWING — b comes after a in document order.
    expect(lead.compareDocumentPosition(trail) & 4).toBeTruthy();
    expect(trail.compareDocumentPosition(bell) & 4).toBeTruthy();
  });

  it("the override takes over the whole row (title and back chevron yield)", () => {
    renderHeader(<AppHeader title="Pane" onBack={() => {}} override={<div>FINDBAR</div>} />);
    expect(screen.getByText("FINDBAR")).toBeInTheDocument();
    expect(screen.queryByText("Pane")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
