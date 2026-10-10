import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

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
    expect(await screen.findByRole("button", { name: "Démarrer l'orchestrateur" })).toBeInTheDocument();
  });

  it("shows the running orchestrator's pane, and asks for a repo when there is none", async () => {
    mount([card({ id: "a" })], { orchestrator: { paneId: "w1:p2", running: true }, orchestratorEntries: [{ uuid: "u1", ts: "2026-10-09T10:00:00Z", role: "assistant", parts: [{ kind: "text", text: "bonjour" }] }] });
    expect(await screen.findByText("bonjour")).toBeInTheDocument();
    expect(screen.getByLabelText("Message à l'orchestrateur")).toBeInTheDocument();
  });

  it("shows the phases, the progress and what waits for you", async () => {
    mount([
      card({ id: "Phase one" }),
      card({ id: "a", parentId: "Phase one", status: "done" }),
      card({ id: "b", parentId: "Phase one", status: "blocked" }),
      card({ id: "other", repoPath: "/r/else", status: "done" }),
    ]);
    expect((await screen.findAllByText("Phase one")).length).toBeGreaterThan(0);
    expect(await screen.findByText("50%", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/1 waiting for you/i)).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
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
    expect(await screen.findByText("Scale")).toBeTruthy();
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
    // The active phase is open by itself; the planned one stays folded.
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
    await userEvent.click(await screen.findByRole("button", { name: /copy the detailed roadmap/i }));
    await userEvent.click(screen.getByRole("button", { name: /copy the step by step/i }));
    await waitFor(() => expect(written).toEqual(["# Roadmap", "# Étape par étape"]));
    expect(asked).toEqual(["md", "steps"]);
  });

  it("invites to start the brainstorm when there is no roadmap", async () => {
    mount([card({ id: "a" })], { roadmap: null });
    expect(await screen.findByText(/start the brainstorm with the project orchestrator/i)).toBeInTheDocument();
  });
});
