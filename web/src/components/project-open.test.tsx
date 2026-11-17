import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { isFreeShell } from "@/lib/agent-groups";
import { server } from "@/test/setup";
import { ProjectOpen } from "./project-open";

const Pane = () => <p>pane {useParams().paneId}</p>;

type Opened = { engine: string; fallback: boolean; place: { space: string; tab: string | null } };
const IN_APP: Opened = { engine: "hc", fallback: false, place: { space: "Collie Board", tab: "app · terminal" } };

function mount(opened: Opened = IN_APP, launch = { engine: "hc", fallback: false }) {
  const bodies: unknown[] = [];
  server.use(
    http.get("/api/board/launch-engine", () => HttpResponse.json(launch)),
    http.get("/api/templates", () => HttpResponse.json({ templates: [], modelKinds: [] })),
    http.post("/api/project/open", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ ok: true, ...opened, pane: { paneId: "t9", workspaceId: "hc", workspaceLabel: "hc", tabId: "hc", cwd: "/r/app" } });
    }),
  );
  const router = createMemoryRouter(
    [
      { path: "/", element: <ProjectOpen repo="/r/app" /> },
      { path: "/pane/:paneId", element: <Pane /> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return bodies;
}

beforeEach(() => setPreference("en"));

describe("ProjectOpen", () => {
  const openTerminal = async (space?: string) => {
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New terminal" }));
    if (space) await userEvent.type(await screen.findByLabelText("herdr-app space"), space);
    await userEvent.click(await screen.findByRole("button", { name: "Open the terminal" }));
  };

  it("« New terminal » opens a shell in Collie Board, says where in a blue box, and enters it on demand", async () => {
    const bodies = mount();
    await openTerminal();
    const note = await screen.findByRole("status");
    expect(note).toHaveAttribute("data-tone", "info");
    expect(note).toHaveTextContent("Terminal opened in herdr-app");
    expect(note).toHaveTextContent("Space « Collie Board », tab « app · terminal ».");
    expect(bodies).toEqual([{ repoPath: "/r/app", open: "terminal" }]);
    await userEvent.click(screen.getByRole("button", { name: "Open in Collie" }));
    expect(await screen.findByText("pane t9")).toBeInTheDocument();
  });

  it("a typed space goes with the request; the box can be dismissed", async () => {
    const bodies = mount({ ...IN_APP, place: { space: "Revue", tab: "app · terminal" } });
    await openTerminal("Revue");
    expect(await screen.findByRole("status")).toHaveTextContent("Space « Revue »");
    expect(bodies).toEqual([{ repoPath: "/r/app", open: "terminal", space: "Revue" }]);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a fallback to herdr 0.9: the space is greyed with why, and the box turns orange and says why", async () => {
    const bodies = mount({ engine: "herdr09", fallback: true, place: { space: "CrewDesign", tab: null } }, { engine: "herdr09", fallback: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New terminal" }));
    expect(await screen.findByText(/herdr-core is not answering/)).toBeInTheDocument();
    expect(screen.getByLabelText("herdr-app space")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Open the terminal" }));
    const note = await screen.findByRole("status");
    expect(note).toHaveAttribute("data-tone", "attention");
    expect(note).toHaveTextContent("herdr-core was not answering: opened in herdr 0.9, workspace « CrewDesign » — invisible in herdr-app.");
    expect(bodies).toEqual([{ repoPath: "/r/app", open: "terminal" }]);
  });

  it("« New agent » asks which agent first, then starts it in the repo", async () => {
    const bodies = mount();
    await userEvent.click(screen.getByRole("button", { name: "New agent" }));
    await userEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start the agent" }));
    expect(await screen.findByText("pane t9")).toBeInTheDocument();
    expect(bodies).toEqual([{ repoPath: "/r/app", open: "agent", agentKind: "codex", templateId: null }]);
  });
});

describe("isFreeShell", () => {
  it("is an hc terminal opened from a Project page — never a herdr 0.9 shell, never an agent's helper", () => {
    expect(isFreeShell({ workspaceId: "hc", paneLabel: "free-app" })).toBe(true);
    expect(isFreeShell({ workspaceId: "hc", paneLabel: "helper" })).toBe(false);
    expect(isFreeShell({ workspaceId: "hc" })).toBe(false);
    expect(isFreeShell({ workspaceId: "w1", paneLabel: "free-app" })).toBe(false);
  });
});
