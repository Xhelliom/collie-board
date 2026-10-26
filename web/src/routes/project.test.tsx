import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { setPreference } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardView, Lot, Phase, Roadmap } from "@/lib/board";
import type { ProjectData } from "@/lib/board-loaders";
import type { CardFacts } from "@/lib/project-facts";
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

  it("shows the template a step starts with — dashed when inherited from its phase — and the model that ran", async () => {
    const t1 = { id: "t1", key: "reviewer", name: "Reviewer", description: "", agentKind: "claude", model: "opus", brief: "B", builtin: true, worker: false };
    mount(
      [card({ id: "own", phaseId: "P1", templateId: "t2", status: "working", agentKind: "claude" }), card({ id: "inh", phaseId: "P1", status: "working", agentKind: "claude" })],
      {
        phases: [{ ...phase("P1"), templateId: "t1" }],
        templates: { templates: [t1, { ...t1, id: "t2", key: null, name: "Mine", builtin: false, model: null }], modelKinds: ["claude"] },
        facts: { inh: { cardId: "inh", gate: null, lead: null, triage: null, review: null, pr: null, sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null, template: { name: "Reviewer", key: "reviewer", model: "opus" } } },
      },
    );
    await screen.findAllByText("Mine");
    const chip = (name: string) => screen.getAllByText(name).filter((el) => el.tagName === "SPAN");
    expect(chip("Mine")[0]).not.toHaveAttribute("title");
    const inherited = chip("Reviewer").find((el) => el.getAttribute("title") === "from the phase");
    expect(inherited).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Default template" })).toHaveValue("t1");
    expect(screen.getAllByRole("list", { name: "Who did what" }).some((l) => l.textContent?.includes("claude, model opus"))).toBe(true);
  });

  it("keeps the way into the chat in the header, with a dot while the orchestrator runs", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true } });
    const open = await screen.findByRole("button", { name: "Open the orchestrator chat" });
    expect(open.closest("header")).not.toBeNull();
    expect(open.querySelector('[title="running"]')).not.toBeNull();
  });

  it("speaks French when asked to", async () => {
    setPreference("fr");
    mount([card({ id: "a", status: "done" }), card({ id: "b", status: "blocked" })]);
    expect(await screen.findByText(/étape terminée sur 2/)).toBeInTheDocument();
    expect(screen.getAllByText(/t'attend/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Ouvrir le chat de l'orchestrateur/ })).toBeInTheDocument();
  });

  it("shows the phases, the progress and what waits for you", async () => {
    mount([
      card({ id: "Phase one" }),
      card({ id: "a", parentId: "Phase one", status: "done" }),
      card({ id: "b", parentId: "Phase one", status: "blocked" }),
      card({ id: "other", repoPath: "/r/else", status: "done" }),
    ]);
    expect((await screen.findAllByText("Phase one")).length).toBeGreaterThan(0);
    expect(await screen.findByText("50%")).toBeTruthy();
    expect(screen.getByText(/1 waiting for you/i)).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("puts what waits for you right under the figures, folds the steps that merely run, and lists « à toi » first in the filters", async () => {
    mount([card({ id: "a", status: "working" }), card({ id: "b", status: "blocked" }), card({ id: "c", status: "done" })]);
    const waiting = await screen.findByRole("region", { name: "Waiting for you" });
    const summary = screen.getByRole("img", { name: /steps done/ }).closest("header")!;
    expect(summary.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("#step-b [aria-expanded]")).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("#step-a [aria-expanded]")).toHaveAttribute("aria-expanded", "false");
    const names = within(screen.getByRole("group", { name: /filter/i })).getAllByRole("button").map((b) => b.textContent);
    expect(names[1]).toMatch(/^waiting/i);
  });

  it("offers a way out of an empty project", async () => {
    mount([]);
    expect(await screen.findByRole("button", { name: "Ask the orchestrator" })).toBeInTheDocument();
  });

  it("filters the steps by what they are doing, and remembers it", async () => {
    mount([card({ id: "a", status: "done" }), card({ id: "b", status: "ready" })]);
    await screen.findByText("a");
    await userEvent.click(screen.getByRole("button", { name: /^done/ }));
    expect(document.getElementById("step-b")).toBeNull();
    expect(document.getElementById("step-a")).not.toBeNull();
  });

  it("says so when the repo has no cards", async () => {
    mount([]);
    expect(await screen.findByText(/no cards in this repo/i)).toBeTruthy();
  });

  it("lists the phase table's phases with their goal and their cards", async () => {
    mount([card({ id: "x", phaseId: "P1" }), card({ id: "y", phaseId: "P2" })], { phases: [phase("P2", 1), phase("P1", 0)] });
    await screen.findByText("goal of P1");
    expect(document.getElementById("phase-P1")).not.toBeNull();
    expect(document.getElementById("step-x")).not.toBeNull();
  });

  it("shows the roadmap, or says the orchestrator fills it", async () => {
    const roadmap: Roadmap = {
      repoPath: "/r/app",
      vision: "Ship it",
      revision: 2,
      items: [{ id: "1", name: "Scale", goal: "72 players", status: "active", detail: "" }],
    };
    mount([card({ id: "x" })], { roadmap });
    await userEvent.click(await screen.findByRole("button", { name: /go to Scale/i }));
    expect(screen.getByRole("button", { name: /copy the detailed roadmap/i })).toBeTruthy();
  });

  it("explains an empty roadmap", async () => {
    mount([card({ id: "x" })]);
    expect(await screen.findByText(/no roadmap yet/i)).toBeTruthy();
  });

  it("draws a lot as a group that holds its steps, and the rest under \"Not in a lot\"", async () => {
    mount(
      [
        card({ id: "in-lot", phaseId: "P1", runId: "L1" }),
        card({ id: "also-in", phaseId: "P1", runId: "L1" }),
        card({ id: "free-one", phaseId: "P1" }),
      ],
      { phases: [phase("P1")], lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["in-lot", "also-in"] })] },
    );
    const group = await screen.findByRole("region", { name: "Lot Lot A" });
    expect(group).toHaveTextContent("in-lot");
    expect(group).toHaveTextContent("also-in");
    expect(group).not.toHaveTextContent("free-one");
    expect(group).not.toHaveTextContent("in a run");
    expect(screen.getByText(/not in a lot · 1/i)).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: /launch this lot/i }));
    expect(launched).toBe("");
    expect(await screen.findByText(/after first/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /launch 2 cards/i }));
    await waitFor(() => expect(launched).toBe("L1"));
  });

  it("a planned lot whose cards are all done shows done outside the lot, with no Launch", async () => {
    mount([card({ id: "by-hand", phaseId: "P1", runId: "L1", status: "done" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["by-hand"], finished: true, doneOutside: true, done: 1 })],
    });
    const group = await screen.findByRole("region", { name: "Lot Lot A" });
    expect(group).toHaveTextContent(/done outside the lot/i);
    expect(screen.queryByRole("button", { name: /launch this lot/i })).toBeNull();
  });

  it("a halted lot shows why, and Resume posts the operator's gesture", async () => {
    let resumed = "";
    server.use(
      http.post("*/api/runs/:id/resume", ({ params }) => {
        resumed = String(params.id);
        return HttpResponse.json({ resumed: 1 });
      }),
    );
    mount([card({ id: "one", phaseId: "P1", runId: "L1" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["one"], launchedAt: 1, halted: "PR: push rejected" })],
    });
    const group = await screen.findByRole("region", { name: "Lot Lot A" });
    expect(group).toHaveTextContent("halted");
    expect(group).toHaveTextContent("PR: push rejected");
    await userEvent.click(within(group).getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(resumed).toBe("L1"));
  });

  it("a running lot gets a banner up top: progress, each card's state, its pane and its PR", async () => {
    mount(
      [
        card({ id: "a", title: "Alpha", phaseId: "P1", runId: "L1", status: "done" }),
        card({ id: "b", title: "Beta", phaseId: "P1", runId: "L1", status: "working", runtime: { paneId: "w1:p2" } as CardView["runtime"] }),
      ],
      {
        phases: [phase("P1")],
        lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["a", "b"], launchedAt: 1 })],
        facts: { b: { pr: { url: "https://github.com/o/r/pull/7", state: "open" } } as CardFacts },
      },
    );
    const banner = await screen.findByRole("region", { name: "Lot in progress: Lot A" });
    expect(banner).toHaveTextContent("1/2 merged");
    expect(banner).toHaveTextContent("PR open");
    expect(within(banner).getByRole("link", { name: "Open its pane" })).toHaveAttribute("href", "/pane/w1%3Ap2");
    expect(within(banner).getByRole("link", { name: "Open its PR" })).toHaveAttribute("href", "https://github.com/o/r/pull/7");
  });

  it("no running lot, no banner", async () => {
    mount([card({ id: "a", phaseId: "P1", runId: "L1" })], {
      phases: [phase("P1")],
      lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["a"], launchedAt: null })],
    });
    await screen.findByRole("region", { name: "Lot Lot A" });
    expect(screen.queryByRole("region", { name: /Lot in progress/ })).toBeNull();
  });

  it("leads with the key figures, then the running lot, what waits for you and the phase in progress; the rest folds below", async () => {
    mount(
      [
        card({ id: "a", title: "Alpha", phaseId: "P1", runId: "L1", status: "working" }),
        card({ id: "b", title: "Beta", phaseId: "P1", status: "review" }),
        card({ id: "c", title: "Loose one", status: "backlog" }),
      ],
      { phases: [phase("P1")], lots: [lot({ id: "L1", phaseId: "P1", name: "Lot A", cardIds: ["a"], launchedAt: 1 })] },
    );
    const order = [
      await screen.findByRole("button", { name: "Key figures" }),
      screen.getByRole("region", { name: "Lot in progress: Lot A" }),
      screen.getByRole("region", { name: /waiting for you/i }),
      screen.getByRole("heading", { name: "P1" }),
      screen.getByRole("button", { name: "Outside a phase · 1 step" }),
      screen.getByRole("button", { name: "Autonomy" }),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("remembers a folded section on this device, and opens it for what you asked to see", async () => {
    const cards = [card({ id: "a", phaseId: "P1" }), card({ id: "c", title: "Loose one", status: "blocked" })];
    mount(cards, { phases: [phase("P1")] });
    await userEvent.click(await screen.findByRole("button", { name: "Key figures" }));
    await userEvent.click(screen.getByRole("button", { name: "Outside a phase · 1 step" }));
    expect(screen.queryByRole("img", { name: /steps done/ })).toBeNull();
    expect(document.getElementById("step-c")).toBeNull();
    cleanup();
    mount(cards, { phases: [phase("P1")] });
    expect(await screen.findByRole("button", { name: "Key figures" })).toHaveAttribute("aria-expanded", "false");
    // "See" on a step waiting outside a phase unfolds that section.
    const waiting = screen.getByRole("region", { name: /waiting for you/i });
    await userEvent.click(within(waiting).getByRole("button", { name: /Loose one/ }));
    expect(screen.getByRole("button", { name: "Outside a phase · 1 step" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("step-c")).not.toBeNull();
  });

  it("files a step under another phase", async () => {
    let body: unknown = null;
    server.use(
      http.patch("*/api/cards/:id", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, card: {} });
      }),
    );
    mount([card({ id: "x", phaseId: "P1", status: "working" })], { phases: [phase("P1"), phase("P2", 1)] });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /phase/i }), "P2");
    await screen.findByRole("combobox", { name: /phase/i });
    expect(body).toEqual({ phaseId: "P2" });
  });

  it("shows each phase's long form on demand and the decision journal grouped ✅ 🟡 ❓", async () => {
    const roadmap: Roadmap = {
      repoPath: "/r/app",
      vision: "A game.",
      revision: 3,
      items: [
        { id: "p0", name: "Cadrage", goal: "Decide", status: "active", detail: "La démo : le plan est validé." },
        { id: "p1", name: "Prototype", goal: "", status: "planned", detail: "Un portail traversé." },
      ],
      decisions: [
        { id: "d1", text: "Équipes de 16", status: "decided", itemId: "p0" },
        { id: "d2", text: "Véhicules ?", status: "open", itemId: null },
        { id: "d3", text: "Hitscan d'abord", status: "leaning", itemId: null },
      ],
    };
    mount([card({ id: "a" })], { roadmap });
    // Folded by default; the quick link opens the roadmap and the first unfinished phase.
    await userEvent.click(await screen.findByRole("button", { name: /go to Cadrage/i }));
    expect(await screen.findByText("La démo : le plan est validé.")).toBeInTheDocument();
    expect(screen.queryByText("Un portail traversé.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Prototype/ }));
    expect(screen.getByText("Un portail traversé.")).toBeInTheDocument();
    const journal = screen.getByLabelText("Decision journal");
    expect(journal).toHaveTextContent("✅ 1 decided");
    expect(journal).toHaveTextContent("🟡 1 leaning");
    expect(journal).toHaveTextContent("❓ 1 open questions");
    expect(within(screen.getByLabelText("Open questions")).getByText("Véhicules ?")).toBeInTheDocument();
  });

  it("copies the detailed roadmap and the step by step from their own exports", async () => {
    const asked: string[] = [];
    const written: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void written.push(t) } });
    server.use(
      http.get("*/api/roadmap", ({ request }) => {
        const f = new URL(request.url).searchParams.get("format") ?? "";
        asked.push(f);
        return new HttpResponse(f === "steps" ? "# Étape par étape" : "# Roadmap", { headers: { "content-type": "text/markdown" } });
      }),
    );
    mount([card({ id: "a" })], { roadmap: { repoPath: "/r/app", vision: "", revision: 1, items: [], decisions: [] } });
    await userEvent.click(await screen.findByRole("button", { name: /^roadmap/i }));
    await userEvent.click(await screen.findByRole("button", { name: /copy the detailed roadmap/i }));
    await userEvent.click(screen.getByRole("button", { name: /copy the step by step/i }));
    await waitFor(() => expect(written).toEqual(["# Roadmap", "# Étape par étape"]));
    expect(asked).toEqual(["md", "steps"]);
  });

  it("invites to start the brainstorm when there is no roadmap", async () => {
    mount([card({ id: "a" })], { roadmap: null });
    expect(await screen.findByText(/start the brainstorm with the project orchestrator/i)).toBeInTheDocument();
  });

  describe("milestones (ADR 0025)", () => {
    const closed = (id: string, position: number, closedAt: number): Phase => ({ ...phase(id, position), closedAt, closedNote: "shipped" });

    it("reads the headline off the open phase only, and says what was delivered", async () => {
      mount(
        [
          card({ id: "old1", phaseId: "v1", status: "done" }),
          card({ id: "old2", phaseId: "v1", status: "done" }),
          card({ id: "now1", phaseId: "p2", status: "done" }),
          card({ id: "now2", phaseId: "p2", status: "ready" }),
        ],
        { phases: [closed("v1", 0, Date.UTC(2026, 0, 5)), phase("p2", 1)] },
      );
      expect(await screen.findByText(/of 2 steps done/)).toBeInTheDocument();
      expect(screen.getByText(/2 steps delivered in 1 validated phase/)).toBeInTheDocument();
      // The validated phase is folded away: its steps are not in the list until it is opened.
      expect(document.getElementById("step-old1")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
      expect(screen.getByText("shipped")).toBeInTheDocument();
    });

    it("deletes an EMPTY phase after a second tap in place, and offers it on no other phase", async () => {
      let deleted = 0;
      server.use(
        http.delete("*/api/phases/empty", () => {
          deleted++;
          return HttpResponse.json({ ok: true });
        }),
      );
      mount([card({ id: "a", phaseId: "full", status: "ready" })], {
        phases: [phase("empty", 0), phase("full", 1), phase("lotted", 2)],
        lots: [lot({ id: "L", phaseId: "lotted" })],
      });
      const buttons = await screen.findAllByRole("button", { name: "Delete this phase" });
      expect(buttons).toHaveLength(1);
      await userEvent.click(buttons[0]!);
      expect(deleted).toBe(0);
      await userEvent.click(screen.getByRole("button", { name: "Tap again to delete" }));
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
      mount(
        [card({ id: "a", phaseId: "p1", status: "done" }), card({ id: "b", phaseId: "p1", status: "ready" })],
        { phases: [phase("p1", 0), phase("p2", 1)] },
      );
      await userEvent.click((await screen.findAllByRole("button", { name: "Validate this phase" }))[0]!);
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
      expect(confirm).toBeDisabled();
      await userEvent.type(screen.getByLabelText("Name of the milestone"), "v1");
      await userEvent.click(confirm);
      await waitFor(() => expect(body).toEqual({ repoPath: "/r/app", name: "v1", cardIds: ["a", "b"] }));
    });

    it("tidies an old project from the page: a banner counts every finished step outside a validated phase and seals them all", async () => {
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
      expect(await screen.findByText(/3 finished steps are in no validated phase/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Validate everything finished…" }));
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
      mount([
        card({ id: "Dictation" }),
        card({ id: "in-1", parentId: "Dictation", status: "done" }),
        card({ id: "in-2", parentId: "Dictation", status: "done" }),
        card({ id: "free", status: "done" }),
      ]);
      const section = (await screen.findByText("Dictation", { selector: "h2" })).closest("li")!;
      await userEvent.click(within(section).getByRole("button", { name: "Validate this phase" }));
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
      await userEvent.click(await screen.findByRole("button", { name: /^v1/ }));
      await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
      await waitFor(() => expect(hit).toBe(true));
    });

    it("everything validated is a state of its own, not an empty project", async () => {
      mount([card({ id: "d", phaseId: "v1", status: "done" })], { phases: [closed("v1", 0, 1)] });
      expect(await screen.findByText(/Everything is validated/)).toBeInTheDocument();
      expect(screen.getByText("Validated phases · 1")).toBeInTheDocument();
    });

    it("speaks French", async () => {
      setPreference("fr");
      mount([card({ id: "d", phaseId: "v1", status: "done" })], { phases: [closed("v1", 0, 1)] });
      expect(await screen.findByText("Phases validées · 1")).toBeInTheDocument();
      expect(screen.getByText(/Tout est validé/)).toBeInTheDocument();
    });
  });
  it("puts the autonomy settings in a block of the page, not in the orchestrator's chat", async () => {
    let saved: unknown = null;
    server.use(
      http.get("*/api/orchestrator/autonomy", () => HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true } })),
      http.put("*/api/orchestrator/autonomy", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ autonomy: { enabled: true, maxChain: 1, stopOnRed: true } });
      }),
    );
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true } });
    const block = await screen.findByRole("region", { name: "Autonomy" });
    await userEvent.click(await within(block).findByRole("switch", { name: "Let it launch the next planned lot" }));
    await waitFor(() => expect(saved).toEqual({ repoPath: "/r/app", enabled: true }));
    // The panel keeps a link to the block, no longer the settings themselves.
    const aside = screen.getByRole("complementary", { name: "Orchestrator" });
    expect(within(aside).getByRole("link", { name: /Autonomy/ })).toHaveAttribute("href", "/board/project?repo=%2Fr%2Fapp#project-autonomy");
    expect(within(aside).queryByRole("switch")).toBeNull();
  });
  it("lets the operator allow a start when nothing runs, greyed out while autonomy is off", async () => {
    let saved: unknown = null;
    server.use(
      http.get("*/api/orchestrator/autonomy", () => HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true, startWhenIdle: false } })),
      http.put("*/api/orchestrator/autonomy", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ autonomy: { enabled: true, maxChain: 1, stopOnRed: true, startWhenIdle: false, ...(saved as object) } });
      }),
    );
    mount([card({ id: "a" })]);
    const block = await screen.findByRole("region", { name: "Autonomy" });
    const idle = await within(block).findByRole("switch", { name: "May start a lot when nothing is running" });
    expect(idle).toBeDisabled();
    await userEvent.click(within(block).getByRole("switch", { name: "Let it launch the next planned lot" }));
    await waitFor(() => expect(idle).toBeEnabled());
    await userEvent.click(idle);
    await waitFor(() => expect(saved).toEqual({ repoPath: "/r/app", startWhenIdle: true }));
  });
  it("scrolls to the autonomy block once it is rendered, from the orchestrator's link", async () => {
    server.use(http.get("*/api/orchestrator/autonomy", () => HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true } })));
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    localStorage.setItem("collie-fold:project-autonomy", "0"); // folded: the link unfolds it
    mount([card({ id: "a" })], {}, "/board/project?repo=%2Fr%2Fapp#project-autonomy");
    const block = await screen.findByRole("region", { name: "Autonomy" });
    await waitFor(() => expect(scroll.mock.contexts).toContain(block));
  });
});
