import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router";

import { PaneError, RootError } from "./root";

// The barrier used to exist only on the root route, so one bad pane blanked the whole app (UI_AUDIT
// §6.5). These check the two things that fix depends on: a leaf error stays inside its leaf, and the
// way out is a client-side navigation to the parent — not a reload.
//
// React's error boundary logs the caught error; silence it so the suite output stays readable.
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error("pane exploded");
}

function routerWithBrokenPane() {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <nav>root chrome</nav>
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <p>dashboard</p> },
          { path: "board", element: <p>board</p> },
          { path: "pane/:paneId", element: <Boom />, errorElement: <RootError /> },
        ],
      },
    ],
    { initialEntries: ["/pane/p1"] },
  );
}

describe("RootError — a leaf barrier", () => {
  it("keeps the rest of the app mounted when a pane throws", () => {
    render(<RouterProvider router={routerWithBrokenPane()} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("pane exploded")).toBeInTheDocument();
    // The parent layout survived — that's what makes the board and the dashboard still reachable.
    expect(screen.getByText("root chrome")).toBeInTheDocument();
  });

  it("navigates back to the parent instead of reloading", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
      assign: reload,
      search: "",
    } as unknown as Location);

    render(<RouterProvider router={routerWithBrokenPane()} />);
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("honours an explicit parent (a card's parent is the board, not home)", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <p>dashboard</p> },
        { path: "board", element: <p>board</p> },
        { path: "card/:cardId", element: <Boom />, errorElement: <RootError to="/board" /> },
      ],
      { initialEntries: ["/card/c1"] },
    );
    render(<RouterProvider router={router} />);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByText("board")).toBeInTheDocument();
  });

  // The history barrier is the only one whose target isn't known at route-config time — it reads the
  // live :paneId. That it can, from inside an error element, is the assumption worth pinning.
  it("sends the history barrier back to the pane it belongs to", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <p>dashboard</p> },
        { path: "pane/:paneId", element: <p>pane p7</p> },
        { path: "pane/:paneId/history", element: <Boom />, errorElement: <PaneError /> },
      ],
      { initialEntries: ["/pane/p7/history"] },
    );
    render(<RouterProvider router={router} />);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByText("pane p7")).toBeInTheDocument();
  });
});
