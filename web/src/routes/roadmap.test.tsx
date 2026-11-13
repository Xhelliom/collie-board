import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { roadmapLoader } from "@/lib/board-loaders";
import { server } from "@/test/setup";

import { byDirection, RoadmapRoute, visionHeadline } from "./roadmap";

beforeEach(() => setPreference("en"));

const roadmap = (status: string) => ({
  repoPath: "/r/app",
  vision: "# Phones steer the herd\nEvery agent, one tap away.",
  revision: status === "done" ? 2 : 1,
  items: [
    { id: "a", name: "Foundations", goal: "the base", status: "done", detail: "" },
    { id: "b", name: "Autonomy", goal: "it runs alone", status, detail: "## Demo\nIt runs alone" },
    { id: "c", name: "Herdr 0.9", goal: "", status: "planned", detail: "", condition: "the herdr 0.9 release" },
    { id: "x", name: "Old idea", goal: "", status: "dropped", detail: "" },
    { id: "l", name: "Third-party plugins", goal: "", status: "later", detail: "", direction: "Open the project" },
  ],
  decisions: [
    { id: "d1", text: "Self-hosted first", status: "decided", itemId: null },
    { id: "d2", text: "SQLite or Postgres?", status: "open", itemId: "b", domain: "product" },
    { id: "d3", text: "Bun everywhere", status: "leaning", itemId: "b" },
  ],
});

function mount(initial = roadmap("active")) {
  const state = { current: initial, puts: [] as Record<string, unknown>[], decisions: [] as Record<string, unknown>[] };
  server.use(
    http.get("/api/roadmap", () => HttpResponse.json({ roadmap: state.current })),
    http.put("/api/roadmap", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.puts.push(body);
      state.current = { ...state.current, ...(body as object), revision: state.current.revision + 1 } as typeof initial;
      return HttpResponse.json({ roadmap: state.current });
    }),
    http.post("/api/roadmap/decision", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.decisions.push(body);
      return HttpResponse.json({ decision: body, revision: 9 });
    }),
    http.get("/api/phases", () =>
      HttpResponse.json({ phases: [{ id: "p", repoPath: "/r/app", name: "Lot 1", goal: "", position: 0, roadmapItemId: "b", closedAt: null }, { id: "q", repoPath: "/r/app", name: "Base", goal: "", position: 1, roadmapItemId: "a", closedAt: 1 }] }),
    ),
    http.get("/api/goals", () => HttpResponse.json({ goals: [{ id: "g", repoPath: "/r/app", text: "Ship the phone app", status: "active", criteria: [] }] })),
    http.get("/api/cards", () =>
      HttpResponse.json({
        cards: [
          { id: "c1", repoPath: "/r/app", phaseId: "p", status: "done", position: 0, createdAt: 0, title: "one" },
          { id: "c2", repoPath: "/r/app", phaseId: "p", status: "ready", position: 1, createdAt: 0, title: "two" },
        ],
      }),
    ),
  );
  const router = createMemoryRouter(
    [
      { path: "/board/roadmap", loader: roadmapLoader, element: <RoadmapRoute /> },
      { path: "/board/project", element: <p>project page</p> },
      { path: "/board/recette", element: <p>recette page</p> },
    ],
    { initialEntries: ["/board/roadmap?repo=%2Fr%2Fapp"] },
  );
  render(<RouterProvider router={router} />);
  return { state, router };
}

describe("the roadmap page", () => {
  it("says the heading: the vision's title, the objective, the next milestone, the progress", async () => {
    mount();
    expect(await screen.findByText("Phones steer the herd")).toBeInTheDocument();
    expect(screen.getByText("Every agent, one tap away.")).toBeInTheDocument();
    expect(screen.getByText("Ship the phone app")).toBeInTheDocument();
    const cap = screen.getByRole("region", { name: "The heading" });
    expect(within(cap).getByText("Herdr 0.9")).toBeInTheDocument();
    expect(within(cap).getByText("1 step of 3")).toBeInTheDocument();
    expect(screen.getByText("Live, revision 1")).toBeInTheDocument();
  });

  it("lays the path: done as one milestone, now, the planned steps with what they wait on", async () => {
    mount();
    const path = await screen.findByRole("list", { name: "The path, from done to planned" });
    const stops = within(path).getAllByRole("listitem");
    expect(stops[0]).toHaveTextContent("Done: 1 step, up to Foundations");
    expect(stops[1]).toHaveTextContent("Now");
    expect(stops[1]).toHaveTextContent("Autonomy");
    expect(stops[1]).toHaveTextContent("1/2");
    expect(stops[2]).toHaveTextContent("Herdr 0.9");
    expect(stops[2]).toHaveTextContent("waits for: the herdr 0.9 release");
    expect(screen.getByText("1 done, 1 in progress, 1 planned, 1 ideas")).toBeInTheDocument();
    // History: what is done, dated, with what it delivered; the dropped steps too.
    await userEvent.click(within(stops[0]).getByRole("button", { name: "See" }));
    expect(screen.getByRole("link", { name: /what was delivered/ })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp&phase=q");
    expect(screen.getByText("Old idea")).toBeInTheDocument();
    // Now, in detail, with its phase.
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("1 step left of 2")).toBeInTheDocument();
    expect(within(now).getByRole("link", { name: "Open the phase" })).toHaveAttribute("href", "/board/project?repo=%2Fr%2Fapp#phase-p");
  });

  it("edits the vision and adds a step and a far idea, each a PUT at the revision read", async () => {
    const { state } = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("The vision (Markdown)");
    await user.clear(field);
    await user.type(field, "New vision.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.puts[0]).toMatchObject({ vision: "New vision.", revision: 1, repoPath: "/r/app" }));

    await user.click(await screen.findByRole("button", { name: "Add a step" }));
    await user.type(screen.getByLabelText("Name of the step"), "Voice{Enter}");
    await waitFor(() => expect(state.puts[1]).toMatchObject({ revision: 2 }));
    expect((state.puts[1].items as { name: string; status: string }[]).at(-1)).toMatchObject({ name: "Voice", status: "planned" });

    await user.click(screen.getByRole("button", { name: /Open the project/ }));
    expect(screen.getByRole("button", { name: "Third-party plugins" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add an idea" })[0]);
    await user.type(screen.getByLabelText("The idea"), "A marketplace");
    await user.click(screen.getAllByRole("button", { name: "Add an idea" }).at(-1)!);
    await waitFor(() => expect(state.puts[2]).toBeDefined());
    expect((state.puts[2].items as { name: string }[]).at(-1)).toMatchObject({ name: "A marketplace", status: "later", direction: "Open the project" });
  });

  it("opens a step whole: detail, phases, decisions, status, order — and saves it", async () => {
    const { state } = mount();
    const user = userEvent.setup();
    const path = await screen.findByRole("list", { name: "The path, from done to planned" });
    await user.click(within(path).getByRole("button", { name: "Autonomy" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("It runs alone")).toBeInTheDocument();
    expect(within(sheet).getByText("Lot 1")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Decisions of this phase")).toHaveTextContent("Bun everywhere");
    expect(within(sheet).getByText("Step 2 of 5")).toBeInTheDocument();
    await user.selectOptions(within(sheet).getByLabelText("Status"), "done");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.puts[0]).toBeDefined());
    expect((state.puts[0].items as { id: string; status: string }[])[1]).toMatchObject({ id: "b", status: "done" });
  });

  it("moves a step earlier", async () => {
    const { state } = mount();
    const user = userEvent.setup();
    const path = await screen.findByRole("list", { name: "The path, from done to planned" });
    await user.click(within(path).getByRole("button", { name: "Herdr 0.9" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Earlier" }));
    await waitFor(() => expect(state.puts[0]).toBeDefined());
    expect((state.puts[0].items as { id: string }[]).map((i) => i.id)).toEqual(["a", "c", "b", "x", "l"]);
  });

  it("keeps the decisions: to settle, leaning, decided with search, each whole on a tap", async () => {
    const { state } = mount();
    const user = userEvent.setup();
    const open = await screen.findByRole("region", { name: /To settle/ });
    expect(within(open).getByText("SQLite or Postgres?")).toBeInTheDocument();
    expect(within(open).getByText("Product")).toBeInTheDocument();
    expect(within(open).getByRole("link", { name: "Talk it over with the orchestrator" }).getAttribute("href")).toContain("chat=1&draft=");
    await user.click(within(open).getByRole("button", { name: "Settle" }));
    await user.click(within(open).getByRole("button", { name: "Decided" }));
    await waitFor(() => expect(state.decisions[0]).toMatchObject({ id: "d2", status: "decided", repoPath: "/r/app", itemId: "b", domain: "product" }));

    expect(screen.getByText("Bun everywhere")).toBeInTheDocument();
    const decided = screen.getByRole("region", { name: /^Decided/ });
    expect(within(decided).getByText("Self-hosted first")).toBeInTheDocument();
    await user.type(within(decided).getByRole("searchbox"), "nothing like it");
    expect(within(decided).getByText("No decision matches.")).toBeInTheDocument();
  });

  it("shows a new revision on the next poll", async () => {
    const { state, router } = mount();
    expect(await screen.findByText("1 step of 3")).toBeInTheDocument();
    state.current = roadmap("done");
    await act(() => router.revalidate());
    expect(await screen.findByText("2 steps of 3")).toBeInTheDocument();
    expect(screen.getByText("Live, revision 2")).toBeInTheDocument();
  });

  it("enlarges the path to full screen, closed by Escape", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Enlarge" }));
    const full = screen.getByRole("dialog", { name: "The path" });
    // The far directions sit at the end of the line.
    expect(within(full).getByText("Open the project")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "The path" })).toBeNull();
  });
});

describe("pure helpers", () => {
  it("reads the vision's headline", () => {
    expect(visionHeadline("# Title\nRest.")).toEqual({ headline: "Title", rest: "Rest." });
    expect(visionHeadline("One. Two.")).toEqual({ headline: "One.", rest: "Two." });
    expect(visionHeadline("no stop")).toEqual({ headline: "no stop", rest: "" });
  });
  it("groups the far ideas by direction, the direction-less last", () => {
    const i = (id: string, direction?: string) => ({ id, name: id, goal: "", status: "later" as const, direction });
    expect(byDirection([i("a"), i("b", "X"), i("c", "X")]).map((g) => [g.direction, g.items.map((x) => x.id)])).toEqual([
      ["X", ["b", "c"]],
      [null, ["a"]],
    ]);
  });
});
