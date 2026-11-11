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

function mount() {
  const bodies: unknown[] = [];
  server.use(
    http.get("/api/templates", () => HttpResponse.json({ templates: [], modelKinds: [] })),
    http.post("/api/project/open", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ ok: true, pane: { paneId: "t9", workspaceId: "hc", workspaceLabel: "hc", tabId: "hc", cwd: "/r/app" } });
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
  it("« New terminal » opens a shell in the repo and lands in its pane", async () => {
    const bodies = mount();
    await userEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(await screen.findByText("pane t9")).toBeInTheDocument();
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
