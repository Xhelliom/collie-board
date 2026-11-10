import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { useLightbox } from "@/lib/lightbox";
import { byDelivery, isPending, matchesQuery, prLabel, recetteLoader, type RecetteEntry, type RecetteGroup } from "@/lib/recette";
import { server } from "@/test/setup";

import { RecetteChip, RecetteRoute } from "./recette";

const entry = (over: Partial<RecetteEntry> = {}): RecetteEntry => ({
  cardId: "c1",
  capability: "Launch a card on dev from the editor",
  repoPath: "/r/app",
  assignee: null,
  state: "todo",
  followUpDone: false,
  shots: ["dev.png", "chip.png"],
  deliveredAt: Date.now() - 60_000,
  phase: "Phase 1",
  lot: "Lot A",
  steps: [
    { id: "a", text: "Pick dev in Environment", expected: "the dev chip shows", shot: "chip.png", verdict: null },
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

  it("by delivery: phases then lots, newest merge first; a lot's PR only when its entries share one", () => {
    const now = 1_000_000;
    const out = byDelivery([
      entry({ cardId: "old", phaseId: "p1", phase: "P1", runId: "r1", lot: "A", prUrl: "https://gh/o/r/pull/3", deliveredAt: now - 50 }),
      entry({ cardId: "new", phaseId: "p2", phase: "P2", runId: "r2", lot: "B", prUrl: "https://gh/o/r/pull/9", deliveredAt: now }),
      entry({ cardId: "mid", phaseId: "p1", phase: "P1", runId: "r1", lot: "A", prUrl: "https://gh/o/r/pull/4", deliveredAt: now - 10 }),
      entry({ cardId: "loose", phaseId: null, phase: null, runId: null, lot: null, deliveredAt: now - 99 }),
    ]);
    expect(out.map((p) => p.phase)).toEqual(["P2", "P1", null]);
    expect(out[0]!.lots[0]).toMatchObject({ lot: "B", prUrl: "https://gh/o/r/pull/9", at: now });
    expect(out[1]!.lots[0]!.entries.map((e) => e.cardId)).toEqual(["mid", "old"]);
    expect(out[1]!.lots[0]!.prUrl).toBeNull(); // one PR per card: no lot PR
    expect(prLabel("https://github.com/o/r/pull/12")).toBe("PR #12");
    expect(prLabel("https://example/x")).toBe("PR");
  });

  it("searches the capability, the capture names and the steps", () => {
    expect(matchesQuery(entry(), "editor")).toBe(true);
    expect(matchesQuery(entry(), "DEV.PNG")).toBe(true);
    expect(matchesQuery(entry(), "dev chip")).toBe(true);
    expect(matchesQuery(entry(), "nothing like it")).toBe(false);
  });
});

/** What the lightbox store holds — the viewer itself is a <dialog> jsdom cannot show. */
function Shown() {
  const lb = useLightbox();
  return lb ? <output aria-label="lightbox">{`${lb.index}/${lb.images.length}`}</output> : null;
}

describe("RecetteRoute", () => {
  function mount(groups: RecetteGroup[]) {
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups })));
    const router = createMemoryRouter(
      [
        { path: "/board/recette", loader: recetteLoader, element: <><RecetteRoute /><Shown /></> },
        { path: "/card/:cardId", element: <p>card screen</p> },
      ],
      { initialEntries: ["/board/recette?repo=%2Fr%2Fapp"] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("unfolds a few entries in place: Do / Expect, captures, the step's own capture, a text link to the card", async () => {
    mount([
      { usage: "Drive another machine", entries: [entry(), entry({ cardId: "c2", capability: "Already fine", state: "ok", shots: [] })] },
    ]);
    expect(await screen.findByText("Launch a card on dev from the editor")).toBeInTheDocument();
    expect(screen.getByText("Drive another machine")).toBeInTheDocument();
    expect(screen.getByText("1 step to test")).toBeInTheDocument();
    const step = screen.getByText("Pick dev in Environment").closest("li")!;
    expect(within(step).getByText("Do:")).toBeInTheDocument();
    expect(within(step).getByText("Expect:")).toBeInTheDocument();
    expect(within(step).getByText("the dev chip shows")).toBeInTheDocument();
    // The step's capture opens the card's series on it; the strip opens it on its own.
    await userEvent.click(within(step).getByRole("button", { name: "Open chip.png" }));
    expect(screen.getByRole("status", { name: "lightbox" })).toHaveTextContent("1/2");
    await userEvent.click(screen.getAllByRole("button", { name: "Open dev.png" })[0]!);
    expect(screen.getByRole("status", { name: "lightbox" })).toHaveTextContent("0/2");
    expect(screen.getByText("1 step validated")).toBeInTheDocument();
    expect(screen.queryByText("Already fine")).toBeNull();
    // No PR, no file name in the entry — one explicit text link to the card.
    expect(screen.getByRole("link", { name: "Card technical details" })).toHaveAttribute("href", "/card/c1");
    await userEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(screen.getByText("Already fine")).toBeInTheDocument();
  });

  it("filters code or business, and the choice is remembered on the device", async () => {
    const groups = [
      { usage: null, entries: [entry({ cardId: "c1", capability: "Code thing" }), entry({ cardId: "b1", capability: "Offer page", category: "business" })] },
    ];
    mount(groups);
    await screen.findByText("Code thing");
    await userEvent.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.queryByText("Code thing")).toBeNull();
    expect(screen.getByText("Offer page")).toBeInTheDocument();
    expect(localStorage.getItem("collie:card-sort")).toBe("business");
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByText("Code thing")).toBeInTheDocument();
    expect(screen.queryByText("Offer page")).toBeNull();
  });

  it("folds the list when more than three are to test, and a click unfolds one in place", async () => {
    mount([{ usage: null, entries: ["c1", "c2", "c3", "c4"].map((id) => entry({ cardId: id, capability: `Capability ${id}` })) }]);
    const toggle = (await screen.findByText("Capability c2")).closest("button")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Pick dev in Environment")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("Pick dev in Environment")).toHaveLength(1);
  });

  it("labels each verdict and says its effect; a return to the page hides nothing", async () => {
    localStorage.setItem("collie-board-recette-visit:/r/app", String(Date.now() + 60_000)); // an old visit mark: ignored
    mount([{ usage: null, entries: [entry({ prUrl: "https://github.com/o/r/pull/7", phaseId: "p", runId: "r" })] }]);
    const step = (await screen.findByText("Pick dev in Environment")).closest("li")!;
    expect(within(step).getByRole("button", { name: "It works" })).toHaveAttribute("title", expect.stringContaining("leaves « To test »"));
    expect(within(step).getByRole("button", { name: "Skip" })).toHaveAttribute("title", expect.stringContaining("not as passed"));
    expect(within(step).getByRole("button", { name: "It doesn't work" })).toHaveAttribute("title", expect.stringContaining("follow-up card"));
    expect(screen.queryByRole("button", { name: "Since my last visit" })).toBeNull();
    // The thread: phase, lot, card, PR — each a link.
    const thread = screen.getByRole("navigation", { name: "Where it comes from" });
    expect(within(thread).getByRole("link", { name: "Phase 1" })).toHaveAttribute("href", "/board/project?repo=%2Fr%2Fapp");
    expect(within(thread).getByRole("link", { name: "Card" })).toHaveAttribute("href", "/card/c1");
    expect(within(thread).getByRole("link", { name: "PR #7" })).toHaveAttribute("href", "https://github.com/o/r/pull/7");
    expect(screen.getByText("How it works")).toBeInTheDocument();
  });

  it("groups by delivery, and remembers the choice", async () => {
    mount([{ usage: "Use", entries: [entry({ phaseId: "p", runId: "r", prUrl: "https://github.com/o/r/pull/5" })] }]);
    await userEvent.click(await screen.findByRole("button", { name: "By delivery" }));
    expect(screen.getByRole("heading", { name: /Lot A/ })).toHaveTextContent("PR #5");
    expect(localStorage.getItem("collie-board-recette-grouping")).toBe("delivery");
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
    await userEvent.click(within(step).getByRole("button", { name: "It doesn't work" }));
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
    expect(await screen.findByRole("link", { name: "1 to test" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp");
    unmount();
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups: [] })));
    const { container } = render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <RecetteChip repo="/r/app" /> }])} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
