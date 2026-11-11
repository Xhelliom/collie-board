import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPreference } from "@/i18n";
import { ROOT_ROUTE_ID } from "@/lib/loaders";
import { server } from "@/test/setup";
import { MigrateAllHc, MigrateHcButton } from "./migrate-hc-button";

beforeEach(() => setPreference("en"));

/** The bridge's side: which panes it offers, and what a POST answers. */
function bridge(offered: string[], refuse: Record<string, string> = {}) {
  const posts: string[] = [];
  let asked = 0;
  server.use(
    http.get("/api/panes/migrate-hc", ({ request }) => {
      asked++;
      return HttpResponse.json({ available: offered.includes(new URL(request.url).searchParams.get("pane") ?? "") });
    }),
    http.post("/api/panes/migrate-hc", ({ request }) => {
      const pane = new URL(request.url).searchParams.get("pane") ?? "";
      posts.push(pane);
      if (refuse[pane]) return HttpResponse.json({ ok: false, error: refuse[pane], kind: "busy" }, { status: 409 });
      return HttpResponse.json({ ok: true, paneId: "t9" });
    }),
  );
  return { posts, asked: () => asked };
}

describe("MigrateHcButton", () => {
  it("is offered for a pane the bridge says may migrate; two taps migrate it and hand back its new pane", async () => {
    const { posts } = bridge(["w1:p1"]);
    const onDone = vi.fn();
    render(<MigrateHcButton paneId="w1:p1" onDone={onDone} />);

    await userEvent.click(await screen.findByRole("button", { name: "Migrate to herdr-core" }));
    expect(posts).toEqual([]); // the first tap only arms it: it closes a terminal
    await userEvent.click(screen.getByRole("button", { name: /Tap again/ }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith("Agent resumed under herdr-core.", true, "t9"));
    expect(posts).toEqual(["w1:p1"]);
  });

  it("is absent when the bridge does not offer it, and reports a refusal in the bridge's words", async () => {
    bridge([]);
    const { rerender } = render(<MigrateHcButton paneId="w1:p1" onDone={() => {}} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button")).toBeNull();

    bridge(["w1:p2"], { "w1:p2": "il travaille ou attend une réponse" });
    const onDone = vi.fn();
    rerender(<MigrateHcButton paneId="w1:p2" onDone={onDone} />);
    await userEvent.click(await screen.findByRole("button", { name: "Migrate to herdr-core" }));
    await userEvent.click(screen.getByRole("button", { name: /Tap again/ }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith("il travaille ou attend une réponse", false));
  });

  it("asks nothing for a pane already under hc", async () => {
    const { asked } = bridge(["t3"]);
    render(<MigrateHcButton paneId="t3" onDone={() => {}} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(asked()).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("MigrateAllHc", () => {
  const agent = (paneId: string, extra: object = {}) => ({ paneId, agent: "claude", cwd: "/r/app", workspaceId: "w1", workspaceLabel: "demo", status: "idle", ...extra });

  function mount(agents: object[]) {
    const router = createMemoryRouter(
      [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ agents }), element: <MigrateAllHc repo="/r/app" /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
  }

  it("migrates this repo's Claude agents under 0.9 one by one, and lists the refused with why", async () => {
    const { posts } = bridge([], { "w2:p1": "il travaille ou attend une réponse" });
    mount([
      agent("w1:p1", { workspaceLabel: "orchestrator-app" }),
      agent("w2:p1", { paneLabel: "recherche" }),
      agent("w3:p1", { cwd: "/home/u/.herdr/worktrees/app/board-x" }), // a card's worktree of this repo
      agent("t4"), // already under hc
      agent("w5:p1", { agent: "codex" }),
      agent("w6:p1", { cwd: "/r/other" }),
    ]);

    await userEvent.click(await screen.findByRole("button", { name: "Migrate all to herdr-core (3)" }));
    await userEvent.click(screen.getByRole("button", { name: /Tap again/ }));

    expect(await screen.findByText("2 migrated to herdr-core")).toBeInTheDocument();
    expect(screen.getByText("recherche — il travaille ou attend une réponse")).toBeInTheDocument();
    expect(posts).toEqual(["w1:p1", "w2:p1", "w3:p1"]);
  });

  it("shows nothing when no agent of the repo is left under 0.9", async () => {
    mount([agent("t4"), agent("w6:p1", { cwd: "/r/other" })]);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
