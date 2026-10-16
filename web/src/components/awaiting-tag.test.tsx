import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

import { CardTile } from "@/components/card-tile";
import { StepItem } from "@/components/project-step";
import { CardRoute } from "@/routes/card";
import type { Awaiting, CardDetail, CardView } from "@/lib/board";
import type { CardData } from "@/lib/board-loaders";
import type { CardFacts } from "@/lib/project-facts";

// The orchestrator asked the operator about a card (an open decision with its cardId): the tile, the
// step and the card screen carry "The orchestrator awaits your decision", which opens the project's
// orchestrator conversation. Settled, the bridge stops sending `awaiting` and the tag is gone.

const card: CardView = {
  id: "c1", title: "The card", spec: null, rawInput: null, acceptance: [], status: "ready", repoPath: "/r/app",
  baseRef: null, branch: null, workspaceId: null, agentKind: null, parentId: null, duplicateOf: null,
  dependsOn: null, origin: null, originCardId: null, category: null, tag: null, position: 0, createdAt: 0,
  updatedAt: 0, session: null, runtime: null, sessionCount: 0, copilotBusy: false, wrapupPending: false,
  keepWorktree: false, autoHandoff: null, runId: null,
};
const awaiting: Awaiting = { id: "d1", text: "SQLite ou Postgres ?" };
const facts = (a?: Awaiting): CardFacts => ({
  cardId: "c1", gate: null, lead: null, triage: null, review: null, pr: null, sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null,
  ...(a ? { awaiting: a } : {}),
});

function Where() {
  const l = useLocation();
  return <p>at {l.pathname + l.search}</p>;
}

function mount(el: React.ReactElement, path = "/") {
  const router = createMemoryRouter(
    [
      { path, element: el, loader: () => null },
      { path: "/board/project", element: <Where /> },
    ],
    { initialEntries: [path.replace(":cardId", "c1")] },
  );
  render(<RouterProvider router={router} />);
}

const VIEWS: { name: string; view: (a?: Awaiting) => React.ReactElement }[] = [
  { name: "the tile", view: (a) => <CardTile card={card} onClick={() => {}} awaiting={a} /> },
  {
    name: "the step",
    view: (a) => (
      <ul>
        <StepItem card={card} index={0} next={false} open={false} flash={false} predecessor={undefined} facts={facts(a)} onToggle={() => {}} />
      </ul>
    ),
  },
];

describe("the awaiting tag", () => {
  it.each(VIEWS)("$name: shown while open, opens the orchestrator's conversation", async ({ view }) => {
    mount(view(awaiting));
    await userEvent.click(await screen.findByText("The orchestrator awaits your decision"));
    expect(await screen.findByText("at /board/project?repo=%2Fr%2Fapp&chat=1")).toBeInTheDocument();
  });

  it.each(VIEWS)("$name: gone once settled", async ({ view }) => {
    mount(view(undefined));
    await screen.findByText("The card");
    expect(screen.queryByText("The orchestrator awaits your decision")).toBeNull();
  });

  it("the card screen: a real button to the conversation", async () => {
    const detail: CardDetail = {
      card, predecessor: null, parent: null, originCard: null, duplicate: null, children: [], sessions: [], reviews: [], events: [], awaiting,
    };
    const router = createMemoryRouter(
      [
        { path: "/card/:cardId", loader: (): CardData => ({ cardId: "c1", detail, error: false, authError: false }), element: <CardRoute /> },
        { path: "/board/project", element: <Where /> },
      ],
      { initialEntries: ["/card/c1"] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.click(await screen.findByRole("button", { name: /The orchestrator awaits your decision/ }));
    expect(await screen.findByText("at /board/project?repo=%2Fr%2Fapp&chat=1")).toBeInTheDocument();
  });
});
