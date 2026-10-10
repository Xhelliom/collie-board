import { render, screen, waitFor } from "@testing-library/react";
import { setPreference } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrchestratorPanel } from "@/components/orchestrator-panel";
import type { OrchestratorMemory, OrchestratorState } from "@/lib/board";
import type { TranscriptEntry } from "@/lib/types";
import { server } from "@/test/setup";

const turn = (text: string, role: "user" | "assistant" = "assistant"): TranscriptEntry => ({
  uuid: text,
  ts: "2026-10-09T10:00:00Z",
  role,
  parts: [{ kind: "text", text }],
});

function mount(repo: string | null, state: OrchestratorState | null, entries: TranscriptEntry[] = [], memory: OrchestratorMemory | null = null) {
  const router = createMemoryRouter(
    [{ path: "/board/project", loader: () => null, element: <OrchestratorPanel repo={repo} state={state} entries={entries} memory={memory} /> }],
    { initialEntries: ["/board/project"] },
  );
  render(<RouterProvider router={router} />);
}

// The texts asserted here are in one language, whatever the browser says.
beforeEach(() => setPreference("fr"));
afterEach(() => setPreference("en"));

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
    mount("/g/app", { paneId: "w1:p2", running: true }, [turn("Propose-moi la roadmap", "user"), turn("J'ai trouvé 3 cartes sans phase.")]);
    expect(await screen.findByText(/3 cartes sans phase/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plein écran/i })).toHaveAttribute("href", "/pane/w1%3Ap2");
    await userEvent.type(screen.getByLabelText("Message à l'orchestrateur"), "Range-les en deux phases");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByLabelText("Message à l'orchestrateur");
    expect(sent).toEqual({ text: "Range-les en deux phases", submit: true });
    expect(screen.getByLabelText("Message à l'orchestrateur")).toHaveValue("");
  });

  it("sends on Enter, on Super+Enter, and keeps Shift+Enter for a newline", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/pane/w1%3Ap2/reply", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    mount("/g/app", { paneId: "w1:p2", running: true });
    const box = await screen.findByLabelText("Message à l'orchestrateur");
    await userEvent.type(box, "un{Shift>}{Enter}{/Shift}deux");
    expect(sent).toHaveLength(0);
    expect(box).toHaveValue("un\ndeux");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(box, "trois{Meta>}{Enter}{/Meta}");
    await screen.findByLabelText("Message à l'orchestrateur");
    expect(sent).toEqual([
      { text: "un\ndeux", submit: true },
      { text: "trois", submit: true },
    ]);
  });

  it("shows its context gauge, and stays quiet about a hand-over below 50 %", async () => {
    mount("/g/app", { paneId: "w1:p2", running: true, ctxPct: 32 });
    expect(await screen.findByRole("img", { name: /contexte rempli à 32 %/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("from 50 %: alerts, and the hand-over is two taps — ask for the note, then start fresh once it moved", async () => {
    const calls: unknown[] = [];
    server.use(
      http.post("*/api/orchestrator/renew", async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ ok: true, paneId: "w1:p2" });
      }),
    );
    const view = (memoryUpdatedAt: number) => (
      <OrchestratorPanel repo="/g/app" state={{ paneId: "w1:p2", running: true, ctxPct: 61, memoryUpdatedAt }} entries={[]} memory={null} />
    );
    const router = createMemoryRouter([{ path: "/p", loader: () => null, element: view(100) }], { initialEntries: ["/p"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/le contexte se remplit/i);
    // Restarting is not offered before the note was asked for.
    expect(screen.queryByRole("button", { name: "Repartir à neuf" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Lui demander de noter" }));
    expect(calls).toEqual([{ repoPath: "/g/app", step: "ask" }]);
    // …and once asked, it stays closed while the note has not moved.
    expect(await screen.findByRole("button", { name: "Repartir à neuf" })).toBeDisabled();
    expect(screen.getByText(/en attente de sa note/i)).toBeInTheDocument();
  });

  it("opens the second tap once the note's date has advanced past the one at the ask", async () => {
    const calls: unknown[] = [];
    server.use(
      http.post("*/api/orchestrator/renew", async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ ok: true, paneId: "w1:p2" });
      }),
    );
    const state = { current: { paneId: "w1:p2", running: true, ctxPct: 70, memoryUpdatedAt: 100 } as OrchestratorState };
    const Panel = () => <OrchestratorPanel repo="/g/app" state={useLoaderData() as OrchestratorState} entries={[]} memory={null} />;
    const router = createMemoryRouter([{ path: "/p", loader: () => state.current, element: <Panel /> }], { initialEntries: ["/p"] });
    render(<RouterProvider router={router} />);
    await userEvent.click(await screen.findByRole("button", { name: "Lui demander de noter" }));
    state.current = { ...state.current, memoryUpdatedAt: 200 };
    await router.revalidate();
    const restart = await screen.findByRole("button", { name: "Repartir à neuf" });
    await waitFor(() => expect(restart).toBeEnabled());
    await userEvent.click(restart);
    await waitFor(() => expect(calls).toEqual([{ repoPath: "/g/app", step: "ask" }, { repoPath: "/g/app", step: "restart" }]));
  });

  it("shows the memory note read-only, or says there is none yet", async () => {
    mount("/g/app", { paneId: "w1:p2", running: true }, [], { note: "écarté : le mode coop", updatedAt: Date.now() });
    expect(await screen.findByText("écarté : le mode coop")).toBeInTheDocument();
  });
});
