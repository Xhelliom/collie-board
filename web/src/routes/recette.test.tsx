import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { isPending, matchesQuery, recetteLoader, type RecetteEntry, type RecetteGroup } from "@/lib/recette";
import { server } from "@/test/setup";

import { RecetteChip, RecetteRoute } from "./recette";

const entry = (over: Partial<RecetteEntry> = {}): RecetteEntry => ({
  cardId: "c1",
  capability: "Launch a card on dev from the editor",
  repoPath: "/r/app",
  assignee: null,
  state: "todo",
  followUpDone: false,
  shots: ["dev.png"],
  deliveredAt: Date.now() - 60_000,
  phase: "Phase 1",
  lot: "Lot A",
  steps: [
    { id: "a", text: "Pick dev in Environment", expected: "the dev chip shows", verdict: null },
    { id: "b", text: "Start the card", verdict: { status: "ok", by: "operator", at: 1 } },
  ],
  ...over,
});

beforeEach(() => {
  setPreference("en");
  localStorage.clear();
});
afterEach(() => setPreference("en"));

describe("recette helpers", () => {
  it("keeps the untested and the unfixed KO, drops OK and KO whose fix is delivered", () => {
    expect(isPending(entry())).toBe(true);
    expect(isPending(entry({ state: "ok" }))).toBe(false);
    expect(isPending(entry({ state: "ko" }))).toBe(true);
    expect(isPending(entry({ state: "ko", followUpDone: true }))).toBe(false);
  });

  it("searches the capability, the capture names and the steps", () => {
    expect(matchesQuery(entry(), "editor")).toBe(true);
    expect(matchesQuery(entry(), "DEV.PNG")).toBe(true);
    expect(matchesQuery(entry(), "dev chip")).toBe(true);
    expect(matchesQuery(entry(), "nothing like it")).toBe(false);
  });
});

describe("RecetteRoute", () => {
  function mount(groups: RecetteGroup[]) {
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups })));
    const router = createMemoryRouter(
      [
        { path: "/board/recette", loader: recetteLoader, element: <RecetteRoute /> },
        { path: "/card/:cardId", element: <p>card screen</p> },
      ],
      { initialEntries: ["/board/recette?repo=%2Fr%2Fapp"] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("leads with the captures, folds the validated step, hides the validated card by default", async () => {
    mount([
      { usage: "Drive another machine", entries: [entry(), entry({ cardId: "c2", capability: "Already fine", state: "ok", shots: [] })] },
    ]);
    expect(await screen.findByText("Launch a card on dev from the editor")).toBeInTheDocument();
    expect(screen.getByText("Drive another machine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open dev.png" })).toBeInTheDocument();
    expect(screen.getByText("1 step validated")).toBeInTheDocument();
    expect(screen.queryByText("Already fine")).toBeNull();
    // No PR, no file name in the entry — one discreet link to the card.
    expect(screen.getByRole("link", { name: "Open the card" })).toHaveAttribute("href", "/card/c1");
    await userEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(screen.getByText("Already fine")).toBeInTheDocument();
  });

  it("filters by search", async () => {
    mount([{ usage: null, entries: [entry(), entry({ cardId: "c2", capability: "Share a board", shots: [], steps: [] })] }]);
    await screen.findByText("Share a board");
    await userEvent.type(screen.getByRole("searchbox"), "dev.png");
    expect(screen.queryByText("Share a board")).toBeNull();
    expect(screen.getByText("Launch a card on dev from the editor")).toBeInTheDocument();
  });

  it("a KO with a note creates the follow-up card and opens it", async () => {
    let sent: unknown = null;
    server.use(
      http.post("/api/cards/c1/checks/a", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true, followUp: { id: "f1" } });
      }),
    );
    const router = mount([{ usage: null, entries: [entry()] }]);
    const step = (await screen.findByText("Pick dev in Environment")).closest("li")!;
    await userEvent.click(within(step).getByRole("button", { name: "KO" }));
    const followUp = screen.getByRole("button", { name: "Create a follow-up card" });
    expect(followUp).toBeDisabled(); // a follow-up needs a note
    await userEvent.type(screen.getByRole("textbox", { name: "What happened?" }), "nothing shows");
    await userEvent.click(followUp);
    expect(sent).toEqual({ status: "ko", note: "nothing shows", followUp: true });
    expect(router.state.location.pathname).toBe("/card/f1");
  });
});

describe("RecetteChip", () => {
  it("says how many are to test, and is absent at zero", async () => {
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups: [{ usage: null, entries: [entry(), entry({ cardId: "c2", state: "ok" })] }] })));
    const router = createMemoryRouter([{ path: "*", element: <RecetteChip repo="/r/app" /> }]);
    const { unmount } = render(<RouterProvider router={router} />);
    expect(await screen.findByRole("link", { name: "1 to test" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp&period=all");
    unmount();
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups: [] })));
    const { container } = render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <RecetteChip repo="/r/app" /> }])} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
