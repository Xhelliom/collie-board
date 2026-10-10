import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { useBack } from "./use-back";

function Leaf() {
  const back = useBack("/parent");
  return <button onClick={back}>back</button>;
}

const mount = (start: string) =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: "/", element: <Link to="/leaf">go</Link> },
          { path: "/other", element: <Link to="/leaf">go from other</Link> },
          { path: "/leaf", element: <Leaf /> },
          { path: "/parent", element: <p>parent</p> },
        ],
        { initialEntries: [start] },
      )}
    />,
  );

describe("useBack", () => {
  it("returns to the screen you came from, not to a fixed parent", async () => {
    mount("/other");
    await userEvent.click(screen.getByText("go from other"));
    await userEvent.click(screen.getByText("back"));
    expect(await screen.findByText("go from other")).toBeInTheDocument();
  });

  it("falls back to the parent on a deep link, where there is nothing behind", async () => {
    mount("/leaf");
    await userEvent.click(screen.getByText("back"));
    expect(await screen.findByText("parent")).toBeInTheDocument();
  });
});
