import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";

import { setPreference } from "@/i18n";
import { server } from "@/test/setup";
import { CardTile } from "@/components/card-tile";
import { StepItem } from "@/components/project-step";
import { CardRoute } from "@/routes/card";
import type { CardDetail, CardView, Lot } from "@/lib/board";
import type { CardData } from "@/lib/board-loaders";
import type { CardFacts } from "@/lib/project-facts";
import { lotHold } from "./lot-hold";

// A card of a launched lot is the lead's until the lot is over: the views say "Lot · <name>" and the
// lot's step, never "review" or "merge it yourself", and fold the manual gestures. Three cases each:
// out of any lot, lot running, lot finished.

const card = (over: Partial<CardView> = {}): CardView => ({
  id: "c1", title: "The card", spec: null, rawInput: null, acceptance: [], status: "review", repoPath: "/r/app",
  baseRef: null, branch: "board/x", workspaceId: null, agentKind: null, parentId: null, duplicateOf: null,
  dependsOn: null, origin: null, originCardId: null, category: null, tag: null, position: 0, createdAt: 0,
  updatedAt: 0, session: null, runtime: null, sessionCount: 0, copilotBusy: false, wrapupPending: false,
  keepWorktree: false, autoHandoff: null, runId: "l1", ...over,
});
const lot = (over: Partial<Lot> = {}): Lot => ({
  id: "l1", repoPath: "/r/app", phaseId: null, name: "Auth", position: 0, launchedAt: 1, cardIds: ["c1"], finished: false, ...over,
});
const facts: CardFacts = {
  cardId: "c1", gate: null, lead: null, triage: null, review: null, sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null,
  pr: { url: "https://github.com/o/r/pull/3", state: "open", autoMerge: "refused" },
};
const CASES = [
  { name: "out of any lot", card: card({ runId: null }), lots: [lot()], held: false },
  { name: "lot running", card: card(), lots: [lot()], held: true },
  { name: "lot finished", card: card(), lots: [lot({ finished: true })], held: false },
];

describe("lotHold", () => {
  it.each(CASES)("$name", ({ card: c, lots, held }) => {
    expect(lotHold(c, lots) !== null).toBe(held);
  });

  it("names the lot's step: an agent on it, the lead reading it, its PR going in", () => {
    expect(lotHold(card({ status: "working" }), [lot()])?.step).toBe("running");
    expect(lotHold(card(), [lot()])?.step).toBe("review");
    expect(lotHold(card(), [lot()], true)?.step).toBe("merge");
    // blocked is the operator's, a planned lot drives nothing
    expect(lotHold(card({ status: "blocked" }), [lot()])?.step).toBeNull();
    expect(lotHold(card(), [lot({ launchedAt: null })])).toBeNull();
  });

  it("one PR for the lot: a folded card waits on the merge, and every card points at THE PR", () => {
    const one = lot({ integration: "lot", prUrl: "https://github.com/o/r/pull/9" });
    expect(lotHold(card({ status: "done" }), [one])).toMatchObject({ step: "merge", prUrl: "https://github.com/o/r/pull/9" });
    expect(lotHold(card({ status: "done" }), [lot()])?.step).toBeNull();
  });
});

describe("the board tile", () => {
  it.each(CASES)("$name", ({ card: c, lots, held }) => {
    render(<CardTile card={c} onClick={() => {}} lot={lotHold(c, lots)} />);
    expect(screen.queryByText("Lot · Auth") !== null).toBe(held);
    expect(screen.queryByText("To review") !== null).toBe(!held);
  });
});

describe("the project step", () => {
  it.each(CASES)("$name", ({ card: c, lots, held }) => {
    render(
      <MemoryRouter>
        <ul>
          <StepItem card={c} index={0} next={false} open flash={false} predecessor={undefined} facts={facts} hold={lotHold(c, lots, true)} onToggle={() => {}} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.queryByText("Lot · Auth") !== null).toBe(held);
    expect(screen.queryByText("merge", { exact: true }) !== null).toBe(held);
    expect(screen.queryByText("merge it yourself") !== null).toBe(!held);
  });

  it("one PR for the lot: links the lot's PR, not the card's", () => {
    const c = card();
    render(
      <MemoryRouter>
        <ul>
          <StepItem card={c} index={0} next={false} open flash={false} predecessor={undefined} facts={facts}
            hold={lotHold(c, [lot({ integration: "lot", prUrl: "https://github.com/o/r/pull/9" })])} onToggle={() => {}} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /The lot's PR/ })).toHaveAttribute("href", "https://github.com/o/r/pull/9");
    expect(screen.queryByText(/pull\/3/)).toBeNull();
  });
});

describe("the card screen", () => {
  beforeEach(() => {
    server.use(
      http.get("*/api/cards/:id/integration", () =>
        HttpResponse.json({
          integration: { branch: "board/x", base: "main", ahead: 2, behind: 0, baseDirty: false, branchDirty: false, baseCheckedOut: true, pushed: false },
        }),
      ),
    );
  });
  afterEach(() => setPreference("en"));

  async function mount(c: CardView, l: Lot | null) {
    const detail: CardDetail = {
      card: c, predecessor: null, parent: null, originCard: null, duplicate: null, children: [], sessions: [], reviews: [], events: [], lot: l,
    };
    const router = createMemoryRouter(
      [{ path: "/card/:cardId", loader: (): CardData => ({ cardId: "c1", detail, error: false, authError: false }), element: <CardRoute /> }],
      { initialEntries: ["/card/c1"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "The card" });
  }

  it.each(CASES)("$name", async ({ card: c, lots, held }) => {
    await mount(c, c.runId ? lots[0]! : null);
    expect(screen.queryByText("Lot · Auth") !== null).toBe(held);
    expect(screen.queryByText(/the lead has it/) !== null).toBe(held);
    // the manual gestures: first when nothing drives the card, one tap away while the lot does
    if (held) {
      await new Promise((r) => setTimeout(r, 100)); // long enough for an unfolded section to have loaded
      expect(screen.queryAllByRole("button", { name: /Open a PR/ })).toEqual([]);
      await userEvent.click(screen.getByRole("button", { name: "Take over" }));
    }
    expect((await screen.findAllByRole("button", { name: /Open a PR/ })).length).toBeGreaterThan(0);
  });

  it("one PR for the lot: the banner points at the lot's PR, and at the lot", async () => {
    await mount(card(), lot({ integration: "lot", prUrl: "https://github.com/o/r/pull/9" }));
    expect(screen.getByRole("link", { name: /The lot's PR/ })).toHaveAttribute("href", "https://github.com/o/r/pull/9");
    expect(screen.getByRole("button", { name: "Open the lot" })).toBeInTheDocument();
  });
});
