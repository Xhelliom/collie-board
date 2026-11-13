import { render, screen, waitFor, within } from "@testing-library/react";
import { setPreference } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CardView, Lot, Phase, Roadmap } from "@/lib/board";
import type { ProjectData } from "@/lib/board-loaders";
import { server } from "@/test/setup";
import { ProjectRoute } from "./project";

const card = (o: Partial<CardView> & { id: string }): CardView =>
  ({ title: o.id, status: "backlog", acceptance: [], parentId: null, dependsOn: null, position: 0, createdAt: 0, repoPath: "/r/app", ...o }) as CardView;
const phase = (id: string, position = 0): Phase => ({ id, repoPath: "/r/app", name: id, goal: `goal of ${id}`, position, roadmapItemId: null });
const lot = (o: Partial<Lot> & { id: string }): Lot => ({ repoPath: "/r/app", phaseId: null, name: o.id, position: 0, launchedAt: null, cardIds: [], ...o });

function mount(cards: CardView[], extra: Partial<ProjectData> = {}, url = "/board/project?repo=%2Fr%2Fapp") {
  const data: ProjectData = { cards, error: false, authError: false, phases: [], lots: [], roadmap: null, ...extra };
  const router = createMemoryRouter(
    [
      { path: "/board/project", loader: () => data, element: <ProjectRoute /> },
      { path: "/board", element: <p>board</p> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
}

// The texts asserted here are in one language, whatever the browser says.
beforeEach(() => setPreference("en"));
afterEach(() => setPreference("en"));

describe("ProjectRoute", () => {
  // The filter is remembered across visits; one test's choice must not become the next one's view.
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage in this environment: nothing is remembered either */
    }
  });

  it("docks the orchestrator beside the road map: start button before it exists, its pane after", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: null, running: false } });
    expect(await screen.findByRole("button", { name: "Start the orchestrator" })).toBeInTheDocument();
  });

  it("shows the running orchestrator's pane, and asks for a repo when there is none", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true }, orchestratorEntries: [{ uuid: "u1", ts: "2026-10-09T10:00:00Z", role: "assistant", parts: [{ kind: "text", text: "bonjour" }] }] });
    expect(await screen.findByText("bonjour")).toBeInTheDocument();
    expect(screen.getByLabelText("Message to the orchestrator")).toBeInTheDocument();
  });

  it("keeps the way into the chat in the header, with a dot while the orchestrator runs", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true } });
    const open = await screen.findByRole("button", { name: "Open the orchestrator chat" });
    expect(open.closest("header")).not.toBeNull();
    expect(open.querySelector('[title="running"]')).not.toBeNull();
  });

  it("speaks French, in sentence case", async () => {
    setPreference("fr");
    mount([card({ id: "a", status: "done", phaseId: "P1" }), card({ id: "b", status: "blocked", phaseId: "P1" })], { phases: [phase("P1")] });
    expect(await screen.findByRole("region", { name: "Ce qui t'attend" })).toBeInTheDocument();
    expect(screen.getByText("Phase en cours")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "La phase en chiffres" })).toHaveTextContent(/1fait.*1t'attend/);
    expect(screen.getByRole("button", { name: /Ouvrir le chat de l'orchestrateur/ })).toBeInTheDocument();
  });

  it("leads with what waits for you, then the phase in progress with its ring, the phases to come, and what to tidy", async () => {
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [] })));
    mount(
      [
        card({ id: "a", title: "Alpha", phaseId: "P1", runId: "L1", status: "working" }),
        card({ id: "b", title: "Beta", phaseId: "P1", status: "review" }),
        card({ id: "n", title: "Next one", phaseId: "P2" }),
        card({ id: "c", title: "Loose one", status: "backlog" }),
      ],
      { phases: [phase("P1"), phase("P2", 1)], lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["a"], launchedAt: 1 })] },
    );
    const order = [
      await screen.findByRole("region", { name: "Waiting for you" }),
      screen.getByRole("region", { name: "P1" }),
      screen.getByRole("region", { name: "Next phases" }),
      await screen.findByRole("region", { name: "To tidy" }),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The ring is back in the phase in progress, and each figure opens the Cards tab filtered on it.
    expect(within(order[1]!).getByRole("img", { name: "0 of 2 steps done" })).toHaveTextContent("0 %0 of 2");
    expect(within(order[1]!).getByRole("link", { name: "1 in flight" })).toHaveAttribute("href", "/board?repo=%2Fr%2Fapp&phase=P1&status=working%2Cstarting");
    expect(within(order[1]!).getByRole("link", { name: "0 to test" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp");
    // No objective: no empty panel, one line to tidy with its button.
    expect(screen.queryByRole("region", { name: "Objective" })).toBeNull();
    const tidy = order[3]!;
    expect(tidy).toHaveTextContent("1 card has no phase: no lot will take it.");
    await userEvent.click(await within(tidy).findByRole("button", { name: "Set an objective" }));
    expect(await screen.findByRole("region", { name: "Objective" })).toBeInTheDocument();
  });

  it("offers a way out of an empty project", async () => {
    mount([]);
    expect(await screen.findByRole("button", { name: "Ask the orchestrator" })).toBeInTheDocument();
    expect(screen.getByText(/no cards in this repo/i)).toBeTruthy();
  });

  it("draws every card as ONE line: its title opens the card, two icons — the card, and the agent while one runs — never unfolded", async () => {
    mount(
      [
        card({ id: "run", title: "Running one", phaseId: "P1", status: "working", spec: "A long spec nobody reads here", acceptance: ["crit"], runtime: { paneId: "w1:p2" } as CardView["runtime"] }),
        card({ id: "idle", title: "Idle one", phaseId: "P1", status: "ready", spec: "Another spec" }),
      ],
      { phases: [phase("P1"), phase("P2", 1)] },
    );
    const current = await screen.findByRole("region", { name: "P1" });
    const row = within(current).getByRole("link", { name: "Running one" }).closest("li")!;
    expect(within(row).getByRole("link", { name: "Running one" }).getAttribute("href")).toContain("run");
    expect(within(row).getByRole("link", { name: "Open the card" }).getAttribute("href")).toContain("run");
    expect(within(row).getByRole("link", { name: "Go to the agent" })).toHaveAttribute("href", "/pane/w1%3Ap2");
    const idle = within(current).getByRole("link", { name: "Idle one" }).closest("li")!;
    expect(within(idle).queryByRole("link", { name: "Go to the agent" })).toBeNull();
    // Nothing unfolds: no spec, no criteria, no phase picker on the page.
    expect(screen.queryByText(/long spec/)).toBeNull();
    expect(screen.queryByText("crit")).toBeNull();
    expect(row.querySelector("[aria-expanded]")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^phase/i })).toBeNull();
  });

  it("filters the cards by what they are doing, from the phase's « ⋯ », and remembers it", async () => {
    mount([card({ id: "a", status: "done", phaseId: "P1" }), card({ id: "b", status: "ready", phaseId: "P1" })], { phases: [phase("P1")] });
    const current = await screen.findByRole("region", { name: "P1" });
    await userEvent.click(within(current).getByRole("button", { name: "More actions on the phase P1" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Filter the cards" }));
    const chips = within(screen.getByRole("group", { name: /filter the steps/i })).getAllByRole("button").map((b) => b.textContent);
    expect(chips.map((c) => c?.replace(/\d+$/, ""))).toEqual(["all", "to start", "done"]);
    await userEvent.click(screen.getByRole("button", { name: /^done/ }));
    expect(within(current).queryByRole("link", { name: "b" })).toBeNull();
    expect(within(current).getByRole("link", { name: "a" })).toBeInTheDocument();
    expect(localStorage.getItem("collie-project-filter")).toBe("done");
    await userEvent.click(within(current).getByRole("button", { name: "Filtered: show everything" }));
    expect(within(current).getByRole("link", { name: "b" })).toBeInTheDocument();
  });

  it("puts the phase in progress first — the one a lot runs in — and the others under « Next phases », labelled", async () => {
    mount(
      [card({ id: "x", phaseId: "P1" }), card({ id: "y", phaseId: "P2", runId: "L2", status: "working" })],
      { phases: [phase("P1", 0), phase("P2", 1), phase("P3", 2)], lots: [lot({ id: "L2", phaseId: "P2", name: "Lot B", cardIds: ["y"], launchedAt: 1 })] },
    );
    const current = await screen.findByRole("region", { name: "P2" });
    expect(current).toHaveTextContent("Phase in progress");
    expect(current).toHaveTextContent("goal of P2");
    const next = screen.getByRole("region", { name: "Next phases" });
    expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(next).getByRole("listitem", { name: "P1" })).toHaveTextContent(/Ready.*P1.*0 lots, 1 card/);
    expect(within(next).getByRole("listitem", { name: "P3" })).toHaveTextContent(/To split.*P3.*no lot yet/);
    expect(within(next).queryByRole("listitem", { name: "P2" })).toBeNull();
  });

  it("opens a next phase in place, with its gestures and its cards", async () => {
    mount([card({ id: "x", phaseId: "P1" }), card({ id: "y", title: "Later", phaseId: "P2" }), card({ id: "z", phaseId: "P3" })], {
      phases: [phase("P1", 0), phase("P2", 1), phase("P3", 2)],
    });
    const next = await screen.findByRole("region", { name: "Next phases" });
    expect(within(next).queryByRole("link", { name: "Later" })).toBeNull();
    await userEvent.click(within(within(next).getByRole("listitem", { name: "P2" })).getByRole("button", { name: "See the lots" }));
    expect(within(next).getByRole("link", { name: "Later" })).toBeInTheDocument();
    expect(within(next).getByRole("button", { name: "Validate this phase" })).toBeInTheDocument();
    await userEvent.click(within(next).getByRole("button", { name: "More on the next phases" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open all" }));
    await userEvent.click(within(next).getByRole("button", { name: "More on the next phases" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Fold all" }));
    expect(within(next).queryByRole("link", { name: "Later" })).toBeNull();
  });

  it("links the whole roadmap, keeps its summary and exports under « ⋯ », and lists its planned phases to split", async () => {
    let draft = "";
    const roadmap: Roadmap = {
      repoPath: "/r/app",
      vision: "Ship it",
      revision: 2,
      items: [
        { id: "1", name: "Scale", goal: "72 players", status: "active", detail: "" },
        { id: "2", name: "Leave the old engine", goal: "", status: "planned", condition: "the new one is stable" },
      ],
    };
    mount([card({ id: "x" })], { roadmap });
    const next = await screen.findByRole("region", { name: "Next phases" });
    expect(within(next).getByRole("link", { name: "The whole roadmap" })).toHaveAttribute("href", "/board/roadmap?repo=%2Fr%2Fapp");
    const item = within(next).getByRole("listitem", { name: "Leave the old engine" });
    expect(item).toHaveTextContent(/To split.*waits for: the new one is stable/);
    draft = within(item).getByRole("link", { name: "Ask for the split" }).getAttribute("href") ?? "";
    expect(decodeURIComponent(draft)).toContain("chat=1&draft=Split the roadmap phase “Leave the old engine” into lots and cards.");
    expect(within(next).queryByRole("listitem", { name: "Scale" })).toBeNull();
    await userEvent.click(within(next).getByRole("button", { name: "More on the next phases" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Roadmap summary and exports" }));
    await userEvent.click(await screen.findByRole("button", { name: /go to Scale/i }));
    expect(screen.getByRole("button", { name: /copy the detailed roadmap/i })).toBeTruthy();
  });

  it("labels the next lot to launch READY, with how each card will start, and the rest under \"Not in a lot\"", async () => {
    mount(
      [card({ id: "in-lot", phaseId: "P1", runId: "L1" }), card({ id: "also-in", phaseId: "P1", runId: "L1" }), card({ id: "free-one", phaseId: "P1" })],
      { phases: [phase("P1")], lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["in-lot", "also-in"], maxParallel: 1 })] },
    );
    const group = await screen.findByRole("region", { name: "Lot Lot A" });
    expect(group).toHaveTextContent(/Ready.*Lot A.*2 cards, one at a time/);
    expect(within(group).getByRole("link", { name: "in-lot" }).closest("li")).toHaveTextContent("first of the lot");
    expect(within(group).getByRole("link", { name: "also-in" }).closest("li")).toHaveTextContent("waits for the previous one");
    expect(group).not.toHaveTextContent("free-one");
    expect(screen.getByText(/not in a lot · 1/i)).toBeInTheDocument();
    // Nothing runs: the ready lot also waits for you, with its own button.
    const waiting = screen.getByRole("region", { name: "Waiting for you" });
    expect(waiting).toHaveTextContent("Lot Lot A ready: 2 cards, one at a time. Nothing else is running.");
    expect(within(waiting).getByRole("button", { name: /launch this lot/i })).toBeInTheDocument();
  });
  
  it("shows the lots after the ready one in one line each, and the EMPTY ones, which it deletes after a second tap", async () => {
    const deleted: string[] = [];
    server.use(
      http.delete("*/api/runs/:id", ({ params }) => {
        deleted.push(String(params.id));
        return HttpResponse.json({ ok: true });
      }),
    );
    mount([card({ id: "a", phaseId: "P1", runId: "L1" }), card({ id: "b", title: "Bee", phaseId: "P1", runId: "L2" })], {
      phases: [phase("P1")],
      lots: [
        lot({ id: "L1", phaseId: "P1", name: "First", cardIds: ["a"] }),
        lot({ id: "L2", phaseId: "P1", name: "Second", cardIds: ["b"], position: 1 }),
        lot({ id: "E1", phaseId: "P1", name: "Talking agents", position: 2 }),
        lot({ id: "E2", phaseId: "P1", name: "Recette timeline", position: 3 }),
      ],
    });
    const current = await screen.findByRole("region", { name: "P1" });
    const second = within(current).getByRole("group", { name: "Lot Second" });
    expect(second).toHaveTextContent(/Next.*Second.*1 card, starts when the one before finishes/);
    expect(within(current).queryByRole("link", { name: "Bee" })).toBeNull();
    await userEvent.click(within(second).getByRole("button", { name: "See the cards" }));
    expect(within(current).getByRole("link", { name: "Bee" })).toBeInTheDocument();
    const empty = within(current).getByRole("group", { name: "Empty" });
    expect(empty).toHaveTextContent("Talking agents, Recette timeline: no card, nothing to launch.");
    // One of them, from its « ⋯ »; then the others at once.
    await userEvent.click(within(empty).getByRole("button", { name: "Delete one empty lot" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete lot Talking agents" }));
    expect(deleted).toEqual([]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Tap again to delete" }));
    await waitFor(() => expect(deleted).toEqual(["E1"]));
    await userEvent.click(within(empty).getByRole("button", { name: "Delete the 2" }));
    expect(deleted).toEqual(["E1"]);
    await userEvent.click(within(empty).getByRole("button", { name: "Tap again to delete" }));
    await waitFor(() => expect(deleted).toEqual(["E1", "E1", "E2"]));
  });

  it("launches a planned lot only after the sheet lists the cards, then reloads", async () => {
    let launched = "";
    server.use(
      http.post("*/api/runs/:id/launch", ({ params }) => {
        launched = String(params.id);
        return HttpResponse.json({ run: {} });
      }),
    );
    mount(
      [card({ id: "first", phaseId: "P1" }), card({ id: "second", phaseId: "P1", dependsOn: "first" })],
      { phases: [phase("P1")], lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["first", "second"] })] },
    );
    await userEvent.click(within(await screen.findByRole("region", { name: "P1" })).getByRole("button", { name: /launch this lot/i }));
    expect(launched).toBe("");
    expect(await screen.findByText(/after first/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /launch 2 cards/i }));
    await waitFor(() => expect(launched).toBe("L1"));
  });

  it("sums the finished lots up in one line, opened on demand", async () => {
    mount([card({ id: "by-hand", phaseId: "P1", runId: "L1", status: "done" }), card({ id: "next", phaseId: "P1", status: "ready" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["by-hand"], finished: true, doneOutside: true, done: 1 })],
    });
    const current = await screen.findByRole("region", { name: "P1" });
    expect(current).toHaveTextContent("Already finished here: 1 lot, 1 card.");
    expect(current).not.toHaveTextContent("Lot A");
    await userEvent.click(within(current).getByRole("button", { name: "See" }));
    expect(await screen.findByRole("region", { name: "Lot Lot A" })).toHaveTextContent(/done outside the lot/i);
    expect(screen.queryByRole("button", { name: /launch this lot/i })).toBeNull();
  });

  it("a halted lot waits for you in one plain sentence — never the raw error — and Resume posts the operator's gesture", async () => {
    let resumed = "";
    server.use(
      http.post("*/api/runs/:id/resume", ({ params }) => {
        resumed = String(params.id);
        return HttpResponse.json({ resumed: 1 });
      }),
    );
    const raw = "lot merge: 502 Bad Gateway <html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";
    mount([card({ id: "one", phaseId: "P1", runId: "L1", status: "blocked" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["one"], launchedAt: 1, halted: raw })],
    });
    const waiting = await screen.findByRole("region", { name: "Waiting for you" });
    expect(waiting).toHaveTextContent("Lot Lot A halted: GitHub did not answer (a passing outage): resuming is enough.");
    expect(document.body.textContent).not.toContain("<html>");
    expect(document.body.textContent).not.toContain("nginx");
    // The card of a halted lot is said once, by its lot.
    expect(within(waiting).queryByRole("link", { name: "Open" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Lot Lot A" })).getByText("halted")).toBeInTheDocument();
    await userEvent.click(within(waiting).getByRole("button", { name: "Resume the lot" }));
    await waitFor(() => expect(resumed).toBe("L1"));
  });

  it("a long coloured halt reason reads as its error line: no ANSI", async () => {
    const noise = Array.from({ length: 40 }, (_, i) => `\u001b[2m  test ${i} ok\u001b[0m`).join("\n");
    const halted = `\u001b[1mpre-push\u001b[0m\n${noise}\n\u001b[31m✗ pre-push: web tests failed — push aborted.\u001b[0m\n`;
    mount([card({ id: "one", phaseId: "P1", runId: "L1" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["one"], launchedAt: 1, halted })],
    });
    const waiting = await screen.findByRole("region", { name: "Waiting for you" });
    expect(waiting.textContent).not.toContain("\u001b");
    expect(waiting).toHaveTextContent("✗ pre-push: web tests failed — push aborted.");
    expect(waiting).not.toHaveTextContent("test 3 ok");
  });

  it("lists a card to read with a way to open it, a phase to validate, and the tests waiting in the recette", async () => {
    server.use(
      http.get("*/api/recette", () =>
        HttpResponse.json({ groups: [{ entries: [{ state: "todo" }, { state: "todo" }, { state: "ok" }] }] }),
      ),
    );
    mount([card({ id: "rv", title: "Read me", phaseId: "P2", status: "review" }), card({ id: "d", phaseId: "P1", status: "done" })], { phases: [phase("P1"), phase("P2", 1)] });
    const waiting = await screen.findByRole("region", { name: "Waiting for you" });
    const item = within(waiting).getByText(/Read me/).closest("li")!;
    expect(within(item).getByRole("link", { name: "Open" }).getAttribute("href")).toContain("rv");
    expect(within(waiting).getByText("P1").closest("li")).toHaveTextContent("to validate");
    expect(await within(waiting).findByRole("link", { name: "2 tests to do in the acceptance list" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp");
  });

  it("says why the cards outside a phase matter, and sorts them in the Cards tab, filtered", async () => {
    mount([card({ id: "x", phaseId: "P1" }), card({ id: "l1" }), card({ id: "l2" })], { phases: [phase("P1")] });
    const tidy = await screen.findByRole("region", { name: "To tidy" });
    expect(tidy).toHaveTextContent("2 cards have no phase: no lot will take them.");
    expect(within(tidy).getByRole("link", { name: "Sort them" })).toHaveAttribute("href", "/board?repo=%2Fr%2Fapp&phase=none");
    expect(within(tidy).queryByRole("link", { name: "l1" })).toBeNull();
  });

  // Nothing the old page could do is lost (refonte sans perte): each gesture is on the page or behind one link.
  it("keeps every action of the page reachable", async () => {
    const t1 = { id: "t1", key: "reviewer", name: "Reviewer", description: "", agentKind: "claude", model: "opus", brief: "B", builtin: true, worker: false };
    const closedAt = (id: string): Phase => ({ ...phase(id, 9), closedAt: 1, closedNote: "shipped" });
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [] })));
    mount(
      [
        card({ id: "w", phaseId: "P1", runId: "L1", status: "working", runtime: { paneId: "w1:p2" } as CardView["runtime"] }),
        card({ id: "h", phaseId: "P1", runId: "L2", status: "blocked" }),
        card({ id: "p", phaseId: "P1", runId: "L3" }),
        card({ id: "f", phaseId: "P1", status: "done" }),
        card({ id: "old", phaseId: "V1", status: "done" }),
        card({ id: "Dictation" }),
        card({ id: "dict-1", parentId: "Dictation", status: "done" }),
        card({ id: "loose", runId: "L5" }),
      ],
      {
        phases: [phase("P1", 0), phase("EMPTY", 1), closedAt("V1")],
        lots: [
          lot({ id: "L1", phaseId: "P1", name: "Running", cardIds: ["w"], launchedAt: 1 }),
          lot({ id: "L2", phaseId: "P1", name: "Stopped", cardIds: ["h"], launchedAt: 1, halted: "gate failed" }),
          lot({ id: "L3", phaseId: "P1", name: "Planned", cardIds: ["p"] }),
          lot({ id: "L4", phaseId: "P1", name: "Hollow" }),
          lot({ id: "L5", name: "Stray", cardIds: ["loose"] }),
        ],
        roadmap: { repoPath: "/r/app", vision: "", revision: 1, items: [{ id: "r1", name: "Later", goal: "", status: "planned" }] },
        templates: { templates: [t1], modelKinds: ["claude"] },
        flows: [],
        orchestrator: { paneId: null, running: false },
      },
    );
    const current = await screen.findByRole("region", { name: "P1" });
    const menu = async (scope: HTMLElement, name: string) => {
      await userEvent.click(within(scope).getByRole("button", { name }));
      return screen.getByRole("menu", { name });
    };
    // Header: a new agent, and under « Actions » a new terminal and (on a phone) the pin.
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "New terminal" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Pin to the sidebar" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Pin to the sidebar" })).toBeInTheDocument();
    // What waits: the halted lot, with its button.
    expect(within(screen.getByRole("region", { name: "Waiting for you" })).getByRole("button", { name: "Resume the lot" })).toBeInTheDocument();
    // The phase in progress: its figures, validate it, its lots' gestures, each card's ways out.
    expect(within(current).getAllByRole("link", { name: /^\d+ (done|in flight|waiting for you|to start|to test)$/ })).toHaveLength(5);
    expect(within(current).getByRole("button", { name: "Validate this phase" })).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: /launch this lot/i })).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(within(current).getByRole("link", { name: "Go to the agent" })).toBeInTheDocument();
    expect(within(current).getAllByRole("link", { name: "Open the card" }).length).toBe(4);
    expect(within(within(current).getByRole("region", { name: "Lot Planned" })).getByRole("button", { name: "More actions on lot Planned" })).toBeInTheDocument();
    await menu(within(current).getByRole("region", { name: "Lot Planned" }), "More actions on lot Planned");
    expect(screen.getByRole("menuitem", { name: "Delete lot Planned" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(within(within(current).getByRole("group", { name: "Empty" })).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    // Its « ⋯ »: validate (a phone's), settings — default template and flow, manage the templates, the repo's flow —, filter.
    const phaseMenu = await menu(current, "More actions on the phase P1");
    expect(within(phaseMenu).getByRole("menuitem", { name: "Validate this phase" })).toBeInTheDocument();
    expect(within(phaseMenu).getByRole("menuitem", { name: "Filter the cards" })).toBeInTheDocument();
    await userEvent.click(within(phaseMenu).getByRole("menuitem", { name: "Phase settings" }));
    expect(within(current).getByRole("combobox", { name: "Default template" })).toBeInTheDocument();
    expect(within(current).getByRole("combobox", { name: "Flow" })).toBeInTheDocument();
    expect(within(current).getByRole("combobox", { name: "Default flow" })).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: "Manage templates…" })).toBeInTheDocument();
    // The phases to come: open any, delete an empty one, validate an old dictation, split the roadmap's, the roadmap.
    const next = screen.getByRole("region", { name: "Next phases" });
    expect(within(next).getByRole("link", { name: "The whole roadmap" })).toBeInTheDocument();
    expect(within(within(next).getByRole("listitem", { name: "Later" })).getByRole("link", { name: "Ask for the split" })).toBeInTheDocument();
    const nextMenu = await menu(next, "More on the next phases");
    expect(within(nextMenu).getByRole("menuitem", { name: "Roadmap summary and exports" })).toBeInTheDocument();
    await userEvent.click(within(nextMenu).getByRole("menuitem", { name: "Open all" }));
    await menu(within(next).getByRole("listitem", { name: "EMPTY" }), "More actions on the phase EMPTY");
    expect(screen.getByRole("menuitem", { name: "Delete this phase" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(within(within(next).getByRole("listitem", { name: "Dictation" })).getByRole("button", { name: "Validate this phase" })).toBeInTheDocument();
    // To tidy: seal the finished steps, sort the cards outside a phase (their lots under « ⋯ »), set an objective, the deliverables.
    const tidy = await screen.findByRole("region", { name: "To tidy" });
    expect(within(tidy).getByRole("button", { name: "Make it a milestone" })).toBeInTheDocument();
    expect(within(tidy).getByRole("link", { name: "Sort them" })).toBeInTheDocument();
    await menu(tidy, "More on the cards outside a phase");
    await userEvent.click(screen.getByRole("menuitem", { name: "Its lots" }));
    expect(within(tidy).getByRole("region", { name: "Lot Stray" })).toBeInTheDocument();
    expect(within(tidy).getByRole("button", { name: "Set an objective" })).toBeInTheDocument();
    // The history: the validated phases, reopened.
    await userEvent.click(screen.getAllByRole("button", { name: "History" })[0]!);
    await userEvent.click(screen.getByRole("button", { name: /^V1/ }));
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  describe("milestones (ADR 0025)", () => {
    const closed = (id: string, position: number, closedAt: number): Phase => ({ ...phase(id, position), closedAt, closedNote: "shipped" });

    it("says what was delivered in one line, and the validated phases behind its History", async () => {
      mount(
        [
          card({ id: "old1", phaseId: "v1", status: "done" }),
          card({ id: "old2", phaseId: "v1", status: "done" }),
          card({ id: "now1", phaseId: "p2", status: "done" }),
          card({ id: "now2", phaseId: "p2", status: "ready" }),
        ],
        { phases: [closed("v1", 0, Date.UTC(2026, 0, 5)), phase("p2", 1)] },
      );
      expect((await screen.findAllByText(/Already done: 1 validated phase, 2 steps delivered\./)).length).toBeGreaterThan(0);
      expect(screen.queryByText("shipped")).toBeNull();
      await userEvent.click(screen.getAllByRole("button", { name: "History" })[0]!);
      await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
      expect(screen.getByText("shipped")).toBeInTheDocument();
    });

    it("deletes an EMPTY phase after a second tap, from its « ⋯ », and offers it on no other phase", async () => {
      let deleted = 0;
      server.use(
        http.delete("*/api/phases/empty", () => {
          deleted++;
          return HttpResponse.json({ ok: true });
        }),
      );
      mount([card({ id: "a", phaseId: "full", status: "ready" }), card({ id: "b", phaseId: "other", status: "ready" })], {
        phases: [phase("empty", 0), phase("full", 1), phase("lotted", 2), phase("other", 3)],
        lots: [lot({ id: "L", phaseId: "lotted" })],
        templates: { templates: [], modelKinds: [] },
      });
      const current = await screen.findByRole("region", { name: "full" });
      await userEvent.click(within(current).getByRole("button", { name: "More actions on the phase full" }));
      expect(screen.queryByRole("menuitem", { name: "Delete this phase" })).toBeNull();
      await userEvent.keyboard("{Escape}");
      const next = screen.getByRole("region", { name: "Next phases" });
      for (const name of ["lotted", "empty"]) await userEvent.click(within(within(next).getByRole("listitem", { name })).getByRole("button", { name: "See the lots" }));
      await userEvent.click(within(next).getByRole("button", { name: "More actions on the phase lotted" }));
      expect(screen.queryByRole("menuitem", { name: "Delete this phase" })).toBeNull();
      await userEvent.keyboard("{Escape}");
      await userEvent.click(within(next).getByRole("button", { name: "More actions on the phase empty" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Delete this phase" }));
      expect(deleted).toBe(0);
      await userEvent.click(screen.getByRole("menuitem", { name: "Tap again to delete" }));
      await waitFor(() => expect(deleted).toBe(1));
    });

    it("validates a phase after a confirmation, sending its open steps where asked", async () => {
      let body: unknown = null;
      server.use(
        http.post("*/api/phases/p1/close", async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ phase: closed("p1", 0, 1) });
        }),
      );
      mount([card({ id: "a", phaseId: "p1", status: "done" }), card({ id: "b", phaseId: "p1", status: "ready" })], { phases: [phase("p1", 0), phase("p2", 1)] });
      await userEvent.click(within(await screen.findByRole("region", { name: "p1" })).getByRole("button", { name: "Validate this phase" }));
      expect(await screen.findByText("1 finished, 1 still open")).toBeInTheDocument();
      expect(body).toBeNull();
      // The next open phase is the default; a note rides along.
      await userEvent.type(screen.getByLabelText(/Note/), "first release");
      await userEvent.click(screen.getByRole("button", { name: "Validate" }));
      await waitFor(() => expect(body).toEqual({ moveOpenTo: "p2", note: "first release" }));
    });

    it("an old project with no phases can fold its finished steps into a first milestone", async () => {
      let body: unknown = null;
      server.use(
        http.post("*/api/phases/seal", async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ phase: closed("v1", 0, 1), moved: 2 }, { status: 201 });
        }),
      );
      mount([card({ id: "a", status: "done" }), card({ id: "b", status: "done" }), card({ id: "c", status: "ready" })]);
      await userEvent.click(await screen.findByRole("button", { name: /Validate the finished steps as a milestone/ }));
      const confirm = screen.getByRole("button", { name: "Validate" });
      const field = screen.getByLabelText("Name of the milestone");
      // Titles « a », « b » share no theme: the field opens on « misc <date> », editable, never imposed.
      expect(field).toHaveValue(`misc ${new Date().toLocaleDateString("en")}`);
      await userEvent.clear(field);
      expect(confirm).toBeDisabled();
      await userEvent.type(field, "v1");
      await userEvent.click(confirm);
      await waitFor(() => expect(body).toEqual({ repoPath: "/r/app", name: "v1", cardIds: ["a", "b"] }));
    });

    it("tidies an old project from the page: a line counts every finished step outside a validated phase and seals them all", async () => {
      let body: unknown = null;
      server.use(
        http.post("*/api/phases/seal", async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ phase: closed("Historique", 0, 1), moved: 3 }, { status: 201 });
        }),
      );
      mount([
        card({ id: "Dictation" }),
        card({ id: "in-1", parentId: "Dictation", status: "done" }),
        card({ id: "in-2", parentId: "Dictation", status: "done" }),
        card({ id: "free", status: "done" }),
        card({ id: "todo", status: "backlog" }),
      ]);
      expect(await screen.findByText("3 finished steps are in no milestone: they still count in the progress.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Make it a milestone" }));
      await userEvent.clear(screen.getByLabelText("Name of the milestone"));
      await userEvent.type(screen.getByLabelText("Name of the milestone"), "Historique");
      await userEvent.click(screen.getByRole("button", { name: "Validate" }));
      await waitFor(() => expect(body).toEqual({ repoPath: "/r/app", name: "Historique" }));
    });

    it("validates ONE old dictation as its own phase, named after it", async () => {
      let body: unknown = null;
      server.use(
        http.post("*/api/phases/seal", async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ phase: closed("Dictation", 0, 1), moved: 2 }, { status: 201 });
        }),
      );
      mount([card({ id: "Dictation" }), card({ id: "in-1", parentId: "Dictation", status: "done" }), card({ id: "in-2", parentId: "Dictation", status: "done" }), card({ id: "free", status: "done" })]);
      const row = await screen.findByRole("listitem", { name: "Dictation" });
      await userEvent.click(within(row).getByRole("button", { name: "See the lots" }));
      await userEvent.click(within(row).getByRole("button", { name: "Validate this phase" }));
      expect(screen.getByLabelText("Name of the milestone")).toHaveValue("Dictation");
      await userEvent.click(screen.getByRole("button", { name: "Validate" }));
      await waitFor(() => expect(body).toEqual({ repoPath: "/r/app", name: "Dictation", cardIds: ["in-1", "in-2"] }));
    });

    it("reopens a validated phase", async () => {
      let hit = false;
      server.use(
        http.post("*/api/phases/v1/reopen", () => {
          hit = true;
          return HttpResponse.json({ phase: phase("v1") });
        }),
      );
      mount([card({ id: "d", phaseId: "v1", status: "done" })], { phases: [closed("v1", 0, 1)] });
      await userEvent.click((await screen.findAllByRole("button", { name: "History" }))[0]!);
      await userEvent.click(await screen.findByRole("button", { name: /^v1/ }));
      await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
      await waitFor(() => expect(hit).toBe(true));
    });

    it("everything validated is a state of its own, not an empty project", async () => {
      mount([card({ id: "d", phaseId: "v1", status: "done" })], { phases: [closed("v1", 0, 1)] });
      expect(await screen.findByText(/Everything is validated/)).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole("button", { name: "History" })[0]!);
      expect(screen.getByText("Validated phases · 1")).toBeInTheDocument();
    });

    it("speaks French", async () => {
      setPreference("fr");
      mount([card({ id: "d", phaseId: "v1", status: "done" })], { phases: [closed("v1", 0, 1)] });
      expect((await screen.findAllByText(/Déjà fait : 1 phase validée, 1 étape livrée\./)).length).toBeGreaterThan(0);
      expect(screen.getByText(/Tout est validé/)).toBeInTheDocument();
    });
  });

  it("no longer folds the repo settings into the page: they live in the Settings tab", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true } });
    await screen.findByRole("complementary", { name: "Orchestrator" });
    expect(screen.queryByRole("region", { name: "Autonomy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Autonomy" })).toBeNull();
    // Nor does the orchestrator panel point at them any more: autonomy is a Settings matter only.
    const aside = screen.getByRole("complementary", { name: "Orchestrator" });
    expect(within(aside).queryByRole("link", { name: /Autonomy/ })).toBeNull();
  });
});
