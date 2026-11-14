import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { BoardTabs } from "@/components/board-tabs";
import { server } from "@/test/setup";

import { CustomPageRoute } from "./custom-page";

const at = (url: string, element: React.ReactNode) => render(<RouterProvider router={createMemoryRouter([{ path: "*", element }], { initialEntries: [url] })} />);

describe("custom pages", () => {
  const listing = (tabs: string[]) =>
    server.use(
      http.get("/api/docs/page-tabs", () =>
        HttpResponse.json({
          ref: "main",
          pages: [{ name: "marketing", size: 9 }, { name: "roadmap", size: 9 }],
          deliverables: [{ cardId: "c1", cardTitle: "Plan", name: "offre.html", size: 9 }],
          tabs,
        }),
      ),
    );

  it("adds a tab only for the pages ticked « En onglet », whatever their name", async () => {
    listing(["marketing", "roadmap", "c1/offre.html"]);
    at("/board/page?repo=%2Fr%2Fapp&name=marketing", <BoardTabs />);
    const tab = await screen.findByRole("link", { name: "marketing" });
    expect(tab).toHaveAttribute("href", "/board/page?repo=%2Fr%2Fapp&name=marketing");
    expect(tab).toHaveAttribute("aria-current", "page");
    // A page named « roadmap » is a page like any other — no name is set aside.
    expect(screen.getByRole("link", { name: "roadmap" })).toHaveAttribute("href", "/board/page?repo=%2Fr%2Fapp&name=roadmap");
    expect(screen.getByRole("link", { name: "offre" })).toHaveAttribute("href", "/board/page?repo=%2Fr%2Fapp&card=c1&name=offre.html");
  });

  it("adds no tab for a page nobody ticked", async () => {
    listing([]);
    at("/board/project?repo=%2Fr%2Fapp", <BoardTabs />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  it("frames the page sandboxed with no allowance, and full screen leaves on its button or Escape", async () => {
    at("/board/page?repo=%2Fr%2Fapp&name=marketing", <CustomPageRoute />);
    const frame = screen.getByTitle("Project page marketing");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("src", "/api/docs/page?repo=%2Fr%2Fapp&name=marketing");
    const box = frame.parentElement!;
    await userEvent.click(within(box).getByRole("button", { name: /Full screen/ }));
    expect(box).toHaveClass("fixed", "inset-0");
    await userEvent.keyboard("{Escape}");
    expect(box).not.toHaveClass("fixed");
    await userEvent.click(within(box).getByRole("button", { name: /Full screen/ }));
    await userEvent.click(within(box).getByRole("button", { name: /Exit full screen/ }));
    expect(box).not.toHaveClass("fixed");
  });

  it("frames a card's HTML deliverable from its deliverable route", () => {
    at("/board/page?repo=%2Fr%2Fapp&card=c1&name=offre.html", <CustomPageRoute />);
    const frame = screen.getByTitle("Project page offre.html");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("src", "/api/cards/c1/deliverables/offre.html");
  });
});
