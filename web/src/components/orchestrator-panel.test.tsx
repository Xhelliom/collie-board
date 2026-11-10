import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// The rare actions live behind the header's ⋯ button; each pick closes the menu.
const openMenu = async () => userEvent.click(await screen.findByRole("button", { name: "Actions de l'orchestrateur" }));
const item = (name: string) => screen.getByRole("menuitem", { name });

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

  it("an attached image is an [Image #N] token at the caret, shown as a data: thumbnail, and its path is sent once", async () => {
    let owner = "";
    let sent: { text?: string } = {};
    server.use(
      http.post(/\/api\/pane\/[^/]+\/upload$/, ({ request }) => {
        owner = decodeURIComponent(new URL(request.url).pathname.split("/")[3]);
        return HttpResponse.json({ ok: true, path: "/tmp/shot.png" });
      }),
      http.post("*/api/pane/w1%3Ap2/reply", async ({ request }) => {
        sent = (await request.json()) as { text?: string };
        return HttpResponse.json({ ok: true });
      }),
    );
    mount("/g/app", { paneId: "w1:p2", running: true });
    const box = await screen.findByLabelText<HTMLTextAreaElement>("Message à l'orchestrateur");
    await userEvent.type(box, "regarde ici");
    box.setSelectionRange(7, 7); // caret right after "regarde"
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
    fireEvent.click(await screen.findByRole("button", { name: "Joindre" }));
    // The field shows the token where the caret stood — never the raw path.
    await waitFor(() => expect(box).toHaveValue("regarde [Image #1] ici"));
    expect(owner).toBe("w1:p2");
    // The thumbnail is a data: URL — the one local image URL the CSP lets through (blob: is refused).
    expect(screen.getByAltText("#1").getAttribute("src")).toMatch(/^data:image\/png/);

    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(sent.text).toBe("regarde /tmp/shot.png ici"));
  });

  it("removing the thumbnail removes the token, and deleting the token removes the thumbnail", async () => {
    server.use(http.post(/\/api\/pane\/[^/]+\/upload$/, () => HttpResponse.json({ ok: true, path: "/tmp/shot.png" })));
    mount("/g/app", { paneId: "w1:p2", running: true });
    const box = await screen.findByLabelText("Message à l'orchestrateur");
    const attach = async () => {
      const file = new File(["x"], "shot.png", { type: "image/png" });
      fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
      fireEvent.click(await screen.findByRole("button", { name: "Joindre" }));
    };
    await attach();
    await waitFor(() => expect(box).toHaveValue("[Image #1]"));
    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image #1" }));
    expect(box).toHaveValue("");

    await attach();
    await waitFor(() => expect(box).toHaveValue("[Image #1]"));
    await screen.findByAltText("#1");
    fireEvent.change(box, { target: { value: "sans image" } });
    expect(screen.queryByAltText("#1")).not.toBeInTheDocument();
  });

  it("offers the picker as a button too, for a phone", async () => {
    mount("/g/app", { paneId: "w1:p2", running: true });
    expect(await screen.findByRole("button", { name: "Joindre une image" })).toBeEnabled();
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

  it("from 50 %: alerts, and asking for the note never gates starting afresh", async () => {
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
    // Restarting is always on offer: a note that was not needed must not block it.
    await openMenu();
    expect(item("Repartir à neuf")).toBeEnabled();
    await userEvent.click(item("Lui demander de noter"));
    expect(calls).toEqual([{ repoPath: "/g/app", step: "ask" }]);
    // …and asking changes nothing about it, only shows that the note is awaited.
    expect(await screen.findByText(/en attente de sa note/i)).toBeInTheDocument();
    await openMenu();
    expect(item("Lui demander de noter")).toBeDisabled();
    expect(item("Repartir à neuf")).toBeEnabled();
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
    await openMenu();
    await userEvent.click(item("Lui demander de noter"));
    state.current = { ...state.current, memoryUpdatedAt: 200 };
    await router.revalidate();
    await openMenu();
    const restart = item("Repartir à neuf");
    await waitFor(() => expect(restart).toBeEnabled());
    await userEvent.click(restart);
    await waitFor(() => expect(calls).toEqual([{ repoPath: "/g/app", step: "ask" }, { repoPath: "/g/app", step: "restart" }]));
  });

  it("a failed restart says why, in the panel", async () => {
    server.use(
      http.post("*/api/orchestrator/renew", () =>
        HttpResponse.json({ ok: false, error: "L'ancien orchestrateur n'a pas pu être fermé (refus). Il tourne toujours.", kind: "herdr" }, { status: 502 }),
      ),
    );
    mount("/g/app", { paneId: "w1:p2", running: true, ctxPct: 20 });
    await openMenu();
    await userEvent.click(item("Repartir à neuf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/« Repartir à neuf » a échoué : L'ancien orchestrateur n'a pas pu être fermé/);
  });

  describe("deliverables", () => {
    const deliv = (name: string, ts: number) => ({ cardId: "c1", cardTitle: "Carte", name, size: 10, ts });
    const items = [deliv("b.jpg", 200), deliv("a.md", 100)];
    const mountWith = (deliverables: ReturnType<typeof deliv>[]) => {
      const router = createMemoryRouter(
        [{ path: "/p", loader: () => null, element: <OrchestratorPanel repo="/g/app" state={{ paneId: "w1:p2", running: true }} entries={[turn("Fait.")]} deliverables={deliverables} /> }],
        { initialEntries: ["/p"] },
      );
      return render(<RouterProvider router={router} />);
    };
    beforeEach(() => localStorage.clear());

    it("no button without a deliverable", async () => {
      mountWith([]);
      await screen.findByText("Fait.");
      expect(screen.queryByRole("button", { name: /^Livrables/ })).toBeNull();
    });

    it("keeps them out of the thread, behind a counted button whose dot goes once opened", async () => {
      const view = mountWith(items);
      await screen.findByText("Fait.");
      expect(screen.queryByText("b.jpg")).toBeNull();
      const button = screen.getByRole("button", { name: "Livrables (2, nouveaux : 2)" });
      expect(screen.getByTestId("deliverables-new")).toBeInTheDocument();
      await userEvent.click(button);
      expect(await screen.findByText("b.jpg")).toBeInTheDocument();
      expect(screen.getByText("a.md")).toBeInTheDocument();
      expect(screen.getByLabelText("Fil de l'orchestrateur")).not.toHaveTextContent("b.jpg");
      expect(screen.queryByTestId("deliverables-new")).toBeNull();
      // The mark is the device's: a fresh mount stays quiet until a newer one lands.
      view.unmount();
      mountWith(items);
      expect(await screen.findByRole("button", { name: "Livrables (2)" })).toBeInTheDocument();
      expect(screen.queryByTestId("deliverables-new")).toBeNull();
    });
  });

  it("shows the memory note read-only, or says there is none yet", async () => {
    mount("/g/app", { paneId: "w1:p2", running: true }, [], { note: "écarté : le mode coop", updatedAt: Date.now() });
    expect(screen.queryByText("écarté : le mode coop")).toBeNull();
    await openMenu();
    expect(screen.getByText("écarté : le mode coop")).toBeInTheDocument();
  });

  it("keeps the thread alone between header and composer: no autonomy link, no inline actions", async () => {
    mount("/g/app", { paneId: "w1:p2", running: true });
    await screen.findByLabelText("Message à l'orchestrateur");
    expect(screen.queryByRole("link", { name: "Autonomie" })).toBeNull();
    expect(screen.queryByText("Lui demander de noter")).toBeNull();
    expect(screen.queryByText("Mémoire")).toBeNull();
  });
});
