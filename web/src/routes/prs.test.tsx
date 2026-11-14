import { render, screen, waitFor, within } from "@testing-library/react";
import { setPreference } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { laneOf, prVerdict, PrsRoute, rowsOf } from "./prs";
import type { GhPr, OpenPr, PrStatus, PrsReading } from "@/lib/board";
import { server } from "@/test/setup";

const status = (over: Partial<PrStatus>): PrStatus => ({
  state: "open",
  url: "https://github.com/o/r/pull/58",
  mergedAt: null,
  conflicting: false,
  mergeable: false,
  ...over,
});

const gh = (n: number, over: Partial<GhPr> = {}): GhPr => ({
  number: n,
  title: `pr ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  branch: `board/b${n}`,
  createdAt: Date.now() - n * 60_000,
  conflicting: false,
  mergeable: true,
  checks: { state: "green" },
  review: null,
  draft: false,
  ...over,
});

const row = (id: string, pr?: PrStatus | null, extra: Partial<OpenPr> = {}): OpenPr => ({
  card: { id, title: `card ${id}`, status: "done", repoPath: "/home/me/collie-board", branch: `board/${id}` },
  url: "https://github.com/o/r/pull/58",
  openedAt: Date.now() - 3_600_000,
  ...(pr === undefined ? {} : { pr }),
  ...extra,
});

// The texts asserted here are in one language, whatever the browser says.
beforeEach(() => setPreference("en"));
afterEach(() => setPreference("en"));

describe("prVerdict — only what GitHub actually said", () => {
  it("never reads UNKNOWN as mergeable", () => {
    expect(prVerdict(status({ mergeable: true }))).toBe("mergeable");
    expect(prVerdict(status({ conflicting: true }))).toBe("conflict");
    expect(prVerdict(status({}))).toBe("pending");
  });

  it("tells an unchecked row from one GitHub could not be asked about", () => {
    expect(prVerdict(undefined)).toBe("unchecked");
    expect(prVerdict(null)).toBe("unknown");
    expect(prVerdict(status({ state: "merged" }))).toBe("merged");
  });
});

describe("laneOf — ready, waiting or blocked, with the reason", () => {
  const open = status({ mergeable: true });
  it("blocks on a conflict, red checks, a review or a draft, and says which", () => {
    expect(laneOf(status({ conflicting: true }))).toEqual({ lane: "blocked", why: "Conflicts with its base" });
    expect(laneOf(open, gh(1, { checks: { state: "red", name: "ci", detailsUrl: "" } }))).toEqual({ lane: "blocked", why: "Check ci failed" });
    expect(laneOf(open, gh(1, { review: "changes" })).lane).toBe("blocked");
    expect(laneOf(open, gh(1, { draft: true })).lane).toBe("blocked");
  });
  it("waits on running checks and on GitHub still working mergeability out", () => {
    expect(laneOf(open, gh(1, { checks: { state: "pending" } }))).toEqual({ lane: "waiting", why: "Checks running" });
    expect(laneOf(status({}), gh(1, { mergeable: false })).lane).toBe("waiting");
    expect(laneOf(null).lane).toBe("waiting");
  });
  it("is ready only when GitHub says it merges and nothing is red", () => {
    expect(laneOf(open, gh(1))).toEqual({ lane: "ready", why: "Checks green" });
  });
});

describe("rowsOf — the board's off-card PRs are on the list", () => {
  it("lists a docs(plan) PR as documentation, beside the cards'", () => {
    const rows = rowsOf({ prs: [row("a", status({ mergeable: true }))], others: [{ ...gh(9), repoPath: "/r", origin: "plan" }] });
    expect(rows.map((r) => [r.number, r.origin, r.lane])).toEqual([
      [9, "plan", "ready"],
      [58, "card", "ready"],
    ]);
  });
});

describe("PrsRoute", () => {
  function mount(rows: OpenPr[], at = "/board/prs") {
    const router = createMemoryRouter(
      [
        { path: "/board/prs", loader: () => rows, element: <PrsRoute /> },
        { path: "/card/:cardId", element: <p>card screen</p> },
      ],
      { initialEntries: [at] },
    );
    render(<RouterProvider router={router} />);
  }

  /** Every PR state at once: what the screen must keep offering, whatever its layout becomes. */
  const everything = (): PrsReading => ({
    prs: [
      row("ready", status({ mergeable: true }), { github: gh(10), autoMerge: "armed" }),
      row("conflict", status({ conflicting: true }), { github: gh(11, { conflicting: true, mergeable: false }) }),
      row("gone", status({ state: "merged", mergedAt: Date.now() })),
    ],
    others: [
      { ...gh(12), repoPath: "/home/me/collie-board", origin: "plan" },
      { ...gh(13, { checks: { state: "pending" } }), repoPath: "/home/me/collie-board", origin: "plan" },
    ],
    merged: [{ ...gh(3, { title: "landed earlier" }), mergedAt: Date.now() - 60_000, repoPath: "/home/me/collie-board", cardId: null }],
    checkedAt: Date.now(),
  });

  it("reads GitHub once on open — and lists the board's PRs that are on no card", async () => {
    const reads: string[] = [];
    server.use(
      http.get("*/api/board/prs", ({ request }) => {
        reads.push(new URL(request.url).search);
        return HttpResponse.json(everything());
      }),
    );
    mount([row("gone")]);
    expect(await screen.findByText("pr 12")).toBeTruthy();
    expect(reads.every((q) => q === "?check=1")).toBe(true);
    expect(screen.getByText(/· read on GitHub/)).toBeTruthy();
    // The merged one is said to be leaving, not listed as open.
    expect(screen.getByText(/leaving this list/i)).toBeTruthy();
  });

  it("loses no feature: every gesture the screen had, and the new ones, are still there", async () => {
    server.use(http.get("*/api/board/prs", () => HttpResponse.json(everything())));
    mount([]);
    const ready = await screen.findByRole("region", { name: "Ready to merge" });
    const blocked = screen.getByRole("region", { name: "Blocked" });
    const waiting = screen.getByRole("region", { name: "Waiting" });
    // Re-read, merge one, merge all, close, reopen with an agent, open on GitHub, the card's own screen.
    expect(screen.getByRole("button", { name: /re-read on github/i })).toBeTruthy();
    expect(within(ready).getAllByRole("button", { name: /^merge$/i })).toHaveLength(2);
    expect(within(ready).getByRole("button", { name: /merge all 2/i })).toBeTruthy();
    expect(within(blocked).getByRole("button", { name: /update with an agent/i })).toBeTruthy();
    expect(within(blocked).getByRole("button", { name: /close/i })).toBeTruthy();
    // « Open on GitHub » waits in the row's ⋯.
    await userEvent.click(within(blocked).getByRole("button", { name: /more actions/i }));
    expect(within(blocked).getByRole("menuitem", { name: /open on github/i })).toBeTruthy();
    expect(within(waiting).getByText("pr 13")).toBeTruthy();
    // The title opens the PR's sheet (which links the card), not GitHub.
    expect(within(ready).getByRole("link", { name: /open pr 10/i })).toHaveAttribute("href", "/board/prs/10?repo=%2Fhome%2Fme%2Fcollie-board");
    // What the journal knows about auto-merge, once per row, not as a paragraph.
    expect(within(ready).getByText("auto-merge armed")).toBeTruthy();
    // The merged ones are one tap away.
    await userEvent.click(screen.getByRole("button", { name: /see the 1 latest merged/i }));
    expect(screen.getByText("landed earlier")).toBeTruthy();
  });

  it("merges all only on a second tap, through the card for a card and by number otherwise", async () => {
    const hits: string[] = [];
    server.use(
      http.get("*/api/board/prs", () => HttpResponse.json(everything())),
      http.post("*/api/cards/:id/integration", async ({ params, request }) => {
        hits.push(`card ${params.id} ${(await request.json() as { action: string }).action}`);
        return HttpResponse.json({ ok: true });
      }),
      http.post("*/api/board/prs/:what", async ({ params, request }) => {
        hits.push(`${params.what} #${(await request.json() as { number: number }).number}`);
        return HttpResponse.json({ ok: true });
      }),
    );
    mount([]);
    const all = await screen.findByRole("button", { name: /merge all 2/i });
    await userEvent.click(all);
    expect(hits).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /tap again to merge 2/i }));
    await waitFor(() => expect(hits.sort()).toEqual(["card ready merge", "merge #12"]));
  });

  it("closes a blocked PR only on a second tap", async () => {
    const hits: string[] = [];
    server.use(
      http.get("*/api/board/prs", () => HttpResponse.json(everything())),
      http.post("*/api/board/prs/:what", async ({ params }) => {
        hits.push(String(params.what));
        return HttpResponse.json({ ok: true });
      }),
    );
    mount([]);
    await userEvent.click(await screen.findByRole("button", { name: /^close$/i }));
    expect(hits).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /tap again to close/i }));
    await waitFor(() => expect(hits).toEqual(["close"]));
  });

  it("reopens a conflicting card's PR with an agent and lands on the card", async () => {
    let sent: unknown = null;
    server.use(
      http.get("*/api/board/prs", () => HttpResponse.json(everything())),
      http.post("*/api/cards/:id/integration", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true, paneId: "w1:p1" });
      }),
    );
    mount([]);
    await userEvent.click(await screen.findByRole("button", { name: /update with an agent/i }));
    expect(await screen.findByText("card screen")).toBeTruthy();
    expect(sent).toMatchObject({ action: "reopen" });
  });

  it("names the repo in the empty state when one is selected", async () => {
    server.use(http.get("*/api/board/prs", () => HttpResponse.json({ prs: [], others: [], merged: [], checkedAt: Date.now() })));
    mount([], "/board/prs?repo=%2Fhome%2Fme%2Fcollie-board");
    expect(await screen.findByText(/No open PRs in collie-board/)).toBeTruthy();
  });
});
