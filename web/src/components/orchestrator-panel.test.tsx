import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { OrchestratorPanel } from "@/components/orchestrator-panel";
import type { OrchestratorState } from "@/lib/board";
import { server } from "@/test/setup";

function mount(repo: string | null, state: OrchestratorState | null, text = "") {
  const router = createMemoryRouter(
    [{ path: "/board/project", loader: () => null, element: <OrchestratorPanel repo={repo} state={state} text={text} /> }],
    { initialEntries: ["/board/project"] },
  );
  render(<RouterProvider router={router} />);
}

describe("OrchestratorPanel", () => {
  it("asks for a repo when none is chosen", async () => {
    mount(null, null);
    expect(await screen.findByText(/choisis un dépôt/i)).toBeInTheDocument();
  });

  it("before it exists: says what it costs, and starts it only on the tap", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/orchestrator", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, paneId: "w1:p2", started: true });
      }),
    );
    mount("/g/app", { paneId: null, running: false });
    expect(await screen.findByText(/consomme ton quota/i)).toBeInTheDocument();
    expect(body).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Démarrer l'orchestrateur" }));
    await screen.findByRole("button", { name: "Démarrer l'orchestrateur" });
    expect(body).toEqual({ repoPath: "/g/app" });
  });

  it("once running: shows its pane, links to the full chat, and sends what you type", async () => {
    let sent: unknown = null;
    server.use(
      http.post("*/api/pane/w1%3Ap2/reply", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    mount("/g/app", { paneId: "w1:p2", running: true }, "J'ai trouvé 3 cartes sans phase.");
    expect(await screen.findByText(/3 cartes sans phase/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plein écran/i })).toHaveAttribute("href", "/pane/w1%3Ap2");
    await userEvent.type(screen.getByLabelText("Message à l'orchestrateur"), "Range-les en deux phases");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByLabelText("Message à l'orchestrateur");
    expect(sent).toEqual({ text: "Range-les en deux phases", submit: true });
    expect(screen.getByLabelText("Message à l'orchestrateur")).toHaveValue("");
  });
});
