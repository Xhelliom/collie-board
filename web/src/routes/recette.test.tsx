import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { useLightbox } from "@/lib/lightbox";
import { byDelivery, dayMark, isPending, matchesQuery, prLabel, recetteLoader, stepDevice, stepTarget, type RecetteEntry, type RecetteGroup } from "@/lib/recette";
import { server } from "@/test/setup";

import { RecetteChip, RecetteRoute } from "./recette";

const entry = (over: Partial<RecetteEntry> = {}): RecetteEntry => ({
  cardId: "c1",
  capability: "Launch a card on dev from the editor",
  repoPath: "/r/app",
  assignee: null,
  state: "todo",
  followUpDone: false,
  shots: ["dev.png", "chip.png"],
  deliveredAt: Date.now() - 60_000,
  phase: "Phase 1",
  lot: "Lot A",
  steps: [
    { id: "a", text: "Pick dev in Environment", expected: "the dev chip shows", shot: "chip.png", verdict: null },
    { id: "b", text: "Start the card", verdict: { status: "ok", by: "operator", at: 1 } },
  ],
  ...over,
});

beforeEach(() => {
  setPreference("en");
  localStorage.clear();
});
afterEach(() => setPreference("en"));

describe("recette helpers", () => {
  it("keeps the untested and the unfixed KO, drops OK and KO whose fix is delivered", () => {
    expect(isPending(entry())).toBe(true);
    expect(isPending(entry({ state: "ok" }))).toBe(false);
    expect(isPending(entry({ state: "ko" }))).toBe(true);
    expect(isPending(entry({ state: "ko", followUpDone: true }))).toBe(false);
  });

  it("by delivery: phases then lots, newest merge first; a lot's PR only when its entries share one", () => {
    const now = 1_000_000;
    const out = byDelivery([
      entry({ cardId: "old", phaseId: "p1", phase: "P1", runId: "r1", lot: "A", prUrl: "https://gh/o/r/pull/3", deliveredAt: now - 50 }),
      entry({ cardId: "new", phaseId: "p2", phase: "P2", runId: "r2", lot: "B", prUrl: "https://gh/o/r/pull/9", deliveredAt: now }),
      entry({ cardId: "mid", phaseId: "p1", phase: "P1", runId: "r1", lot: "A", prUrl: "https://gh/o/r/pull/4", deliveredAt: now - 10 }),
      entry({ cardId: "loose", phaseId: null, phase: null, runId: null, lot: null, deliveredAt: now - 99 }),
    ]);
    expect(out.map((p) => p.phase)).toEqual(["P2", "P1", null]);
    expect(out[0]!.lots[0]).toMatchObject({ lot: "B", prUrl: "https://gh/o/r/pull/9", at: now });
    expect(out[1]!.lots[0]!.entries.map((e) => e.cardId)).toEqual(["mid", "old"]);
    expect(out[1]!.lots[0]!.prUrl).toBeNull(); // one PR per card: no lot PR
    expect(prLabel("https://github.com/o/r/pull/12")).toBe("PR #12");
    expect(prLabel("https://example/x")).toBe("PR");
  });

  it("searches the capability, the capture names and the steps", () => {
    expect(matchesQuery(entry(), "editor")).toBe(true);
    expect(matchesQuery(entry(), "DEV.PNG")).toBe(true);
    expect(matchesQuery(entry(), "dev chip")).toBe(true);
    expect(matchesQuery(entry(), "nothing like it")).toBe(false);
  });
});

/** What the lightbox store holds — the viewer itself is a <dialog> jsdom cannot show. */
function Shown() {
  const lb = useLightbox();
  return lb ? <output aria-label="lightbox">{`${lb.index}/${lb.images.length}`}</output> : null;
}

describe("timeline helpers", () => {
  it("reads the device and the screen off a step's words, the card's page otherwise", () => {
    expect(stepDevice({ text: "Ouvrir Cartes sur le téléphone" })).toBe("phone");
    expect(stepDevice({ text: "Ouvrir Cartes" })).toBe("desktop");
    expect(stepTarget({ text: "Ouvrir l'onglet Cartes" }, "c1", "/r/app")).toEqual({ to: "/board?repo=%2Fr%2Fapp", where: "board" });
    expect(stepTarget({ text: "Valider une étape", expected: "la Recette se met à jour" }, "c1", null)).toEqual({ to: "/board/recette", where: "recette" });
    expect(stepTarget({ text: "Lancer l'agent" }, "c 1", "/r/app")).toEqual({ to: "/card/c%201", where: "card" });
  });

  it("marks today and yesterday", () => {
    const now = new Date(2026, 10, 13, 12).getTime();
    expect(dayMark(now - 3_600_000, now)).toBe("today");
    expect(dayMark(now - 86_400_000, now)).toBe("yesterday");
    expect(dayMark(now - 3 * 86_400_000, now)).toBeNull();
  });
});

describe("RecetteRoute", () => {
  function mount(groups: RecetteGroup[], url = "/board/recette?repo=%2Fr%2Fapp") {
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups })));
    const router = createMemoryRouter(
      [
        { path: "/board/recette", loader: recetteLoader, element: <><RecetteRoute /><Shown /></> },
        { path: "/card/:cardId", element: <p>card screen</p> },
        { path: "/board", element: <p>cards tab</p> },
      ],
      { initialEntries: [url] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("a timeline: the newest waiting delivery opens with its phase, its card, its visual and its steps", async () => {
    setPreference("fr");
    mount([
      {
        usage: "Piloter",
        entries: [
          entry({ title: "Carte dev", phaseId: "p", steps: [
            { id: "a", text: "Choisir dev dans Environnement", expected: "le chip dev s'affiche", shot: "chip.png", verdict: null },
            { id: "b", text: "Démarrer la carte", verdict: { status: "ok", by: "operator", at: 1 } },
            { id: "c", text: "Ouvrir la carte sur le téléphone", verdict: null },
          ] }),
          entry({ cardId: "old", capability: "Plus ancienne", deliveredAt: Date.now() - 3 * 86_400_000 }),
        ],
      },
    ]);
    expect(await screen.findByText("Ce qui a été livré, à vérifier")).toBeInTheDocument();
    expect(screen.getAllByText("Aujourd'hui").length).toBeGreaterThan(0);
    const thread = screen.getAllByRole("navigation", { name: "D'où ça vient" })[0]!;
    expect(within(thread).getByRole("link", { name: "Phase 1" })).toBeInTheDocument();
    expect(within(thread).getByRole("link", { name: "carte : Carte dev" })).toHaveAttribute("href", "/card/c1");
    // The current step: its text, its expected, two buttons and where they lead; no « Faire / Attendu ».
    const step = screen.getByText("Choisir dev dans Environnement").closest("li")!;
    expect(within(step).getByText("le chip dev s'affiche")).toBeInTheDocument();
    expect(screen.queryByText("Faire :")).toBeNull();
    expect(within(step).getByRole("link", { name: "Aller voir" })).toHaveAttribute("href", "/card/c1");
    expect(within(step).getByRole("button", { name: "Me préparer le test" })).toBeInTheDocument();
    expect(within(step).getByRole("button", { name: "C'est bon" })).toBeInTheDocument();
    // Only the current step carries the verdicts; the phone step says so.
    expect(screen.getAllByRole("button", { name: "Pas bon" })).toHaveLength(1);
    expect(screen.getByText("Ouvrir la carte sur le téléphone").closest("li")).toHaveTextContent("téléphone");
    // Each capture once: the large one, and a thumbnail per capture to switch.
    await userEvent.click(within(step).getByRole("button", { name: "voir la capture" }));
    expect(screen.getByRole("button", { name: "chip.png" })).toHaveAttribute("aria-pressed", "true");
    // The older delivery: one line, « Vérifier ».
    const old = screen.getByText("Plus ancienne").closest("article")!;
    expect(within(old).getByText("2 vérifications, 1 faite")).toBeInTheDocument();
    await userEvent.click(within(old).getByRole("button", { name: "Vérifier" }));
    expect(within(screen.getByText("Plus ancienne").closest("article")!).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("« Tout l'historique » keeps what is validated, folded in green", async () => {
    setPreference("fr");
    mount([{ usage: null, entries: [entry(), entry({ cardId: "c2", capability: "Déjà validée", state: "ok", shots: [] })] }]);
    await screen.findByText("Launch a card on dev from the editor");
    expect(screen.queryByText("Déjà validée")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Tout l'historique" }));
    const done = screen.getByText("Déjà validée").closest("article")!;
    expect(within(done).getByText("Validée")).toBeInTheDocument();
    expect(within(done).getByRole("button", { name: /Déjà validée/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("« Pas bon » asks no cause, files the correction card, says where it goes; a note is optional", async () => {
    setPreference("fr");
    const sent: unknown[] = [];
    server.use(
      http.post("/api/cards/c1/checks/a", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true, followUp: { id: "f1" } });
      }),
    );
    const router = mount([{ usage: null, entries: [entry({ title: "Carte dev", fixCardId: "f0" })] }]);
    const step = (await screen.findByText("Pick dev in Environment")).closest("li")!;
    expect(screen.getByText(/Une carte de correction est créée dans « Phase 1 », rattachée à « Carte dev »/)).toBeInTheDocument();
    await userEvent.click(within(step).getByRole("button", { name: "Pas bon" }));
    expect(sent[0]).toEqual({ status: "ko", followUp: true });
    expect(router.state.location.pathname).toBe("/board/recette"); // no detour: the check goes on
    expect(screen.getByRole("link", { name: "Ouvrir la carte de correction" })).toHaveAttribute("href", "/card/f0");
  });

  it("« Me préparer le test » prompts the orchestrator; without one, says how to start it", async () => {
    setPreference("fr");
    let calls = 0;
    server.use(http.post("/api/cards/c1/checks/a/prepare", () => (++calls === 1 ? HttpResponse.json({ ok: true, paneId: "p9" }) : HttpResponse.json({ ok: false, kind: "no-session" }, { status: 409 }))));
    mount([{ usage: null, entries: [entry()] }]);
    const step = (await screen.findByText("Pick dev in Environment")).closest("li")!;
    await userEvent.click(within(step).getByRole("button", { name: "Me préparer le test" }));
    expect(calls).toBe(1);
  });

  it("the one-by-one session: a step at a time, O/N/P, filtered by device", async () => {
    setPreference("fr");
    const sent: string[] = [];
    server.use(
      http.post("/api/cards/:id/checks/:step", async ({ params, request }) => {
        sent.push(`${params.step}:${((await request.json()) as { status: string }).status}`);
        return HttpResponse.json({ ok: true, followUp: null });
      }),
    );
    const router = mount([
      {
        usage: null,
        entries: [entry({ shots: [], steps: [
          { id: "a", text: "Ouvrir la Recette", expected: "la chronologie", verdict: null },
          { id: "b", text: "Ouvrir Cartes sur le téléphone", verdict: null },
        ] })],
      },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Vérifier une à une" }));
    const dialog = screen.getByRole("dialog", { name: "Vérifier une à une" });
    expect(within(dialog).getByText("Étape 1 sur 2")).toBeInTheDocument();
    expect(within(dialog).getByText("la chronologie")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Aller voir" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp");
    await userEvent.keyboard("o");
    expect(sent).toEqual(["a:ok"]);
    expect(router.state.location.search).toContain("step=c1%2Fb");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ordinateur" }));
    expect(within(dialog).queryByText("Ouvrir Cartes sur le téléphone")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Téléphone" }));
    expect(within(dialog).getByText("Ouvrir Cartes sur le téléphone")).toBeInTheDocument();
    expect(within(dialog).getByText("Étape 1 sur 1")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Quitter la session" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no feature is lost: filters, groupings, search, gallery, note, correction card, card detail, help", async () => {
    setPreference("fr");
    mount([{ usage: "Piloter", entries: [entry({ fixCardId: "f0", phaseId: "p", runId: "r", prUrl: "https://github.com/o/r/pull/5", steps: [
      { id: "a", text: "Pick dev in Environment", verdict: { status: "ko", by: "operator", at: 1, note: "rien" } },
      { id: "b", text: "Start the card", verdict: null },
    ] })] }]);
    await screen.findByText("Launch a card on dev from the editor");
    for (const name of ["À vérifier", "Tout l'historique", "Chronologie", "Par usage", "Par livraison", "Vérifier une à une", "2 captures"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Comment ça marche")).toBeInTheDocument();
    // A KO step, picked again: its note, optional, goes to the correction card.
    await userEvent.click(screen.getByText("Pick dev in Environment"));
    expect(screen.getByText("rien")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Qu'est-ce qui s'est passé ? (facultatif)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir la carte de correction" })).toHaveAttribute("href", "/card/f0");
    expect(screen.getByRole("link", { name: "Détail technique de la carte" })).toHaveAttribute("href", "/card/c1");
    expect(screen.getByRole("link", { name: "PR #5" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller voir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Me préparer le test" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2 captures" }));
    expect(screen.getByRole("status", { name: "lightbox" })).toHaveTextContent("0/2");
  });

  it("a business card's recette reads « à relire », not « à tester »", async () => {
    setPreference("fr");
    mount([{ usage: null, entries: [entry({ category: "business", capability: "Relire l'offre" })] }]);
    expect(await screen.findByText("Relire l'offre")).toBeInTheDocument();
    expect(screen.getByText("1 à relire")).toBeInTheDocument();
    expect(screen.getByLabelText("à relire")).toBeInTheDocument();
  });

  it("filters code or business, and the choice is remembered on the device", async () => {
    const groups = [
      { usage: null, entries: [entry({ cardId: "c1", capability: "Code thing" }), entry({ cardId: "b1", capability: "Offer page", category: "business" })] },
    ];
    mount(groups);
    await screen.findByText("Code thing");
    await userEvent.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.queryByText("Code thing")).toBeNull();
    expect(screen.getByText("Offer page")).toBeInTheDocument();
    expect(localStorage.getItem("collie:card-sort")).toBe("business");
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByText("Code thing")).toBeInTheDocument();
    expect(screen.queryByText("Offer page")).toBeNull();
  });

  it("groups by use or by delivery, and remembers the choice", async () => {
    mount([{ usage: "Use", entries: [entry({ phaseId: "p", runId: "r", prUrl: "https://github.com/o/r/pull/5" })] }]);
    await userEvent.click(await screen.findByRole("button", { name: "By delivery" }));
    expect(screen.getByRole("heading", { name: /Lot A/ })).toHaveTextContent("PR #5");
    expect(localStorage.getItem("collie-board-recette-grouping")).toBe("delivery");
    await userEvent.click(screen.getByRole("button", { name: "By use" }));
    expect(screen.getByText("Use")).toBeInTheDocument();
  });

  it("filters by search", async () => {
    mount([{ usage: null, entries: [entry(), entry({ cardId: "c2", capability: "Share a board", shots: [], steps: [] })] }]);
    await screen.findByText("Share a board");
    await userEvent.type(screen.getByRole("searchbox"), "dev.png");
    expect(screen.queryByText("Share a board")).toBeNull();
    expect(screen.getByText("Launch a card on dev from the editor")).toBeInTheDocument();
  });
});

describe("RecetteChip", () => {
  it("says how many are to test, and is absent at zero", async () => {
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups: [{ usage: null, entries: [entry(), entry({ cardId: "c2", state: "ok" })] }] })));
    const router = createMemoryRouter([{ path: "*", element: <RecetteChip repo="/r/app" /> }]);
    const { unmount } = render(<RouterProvider router={router} />);
    expect(await screen.findByRole("link", { name: "1 to test" })).toHaveAttribute("href", "/board/recette?repo=%2Fr%2Fapp");
    unmount();
    server.use(http.get("/api/recette", () => HttpResponse.json({ groups: [] })));
    const { container } = render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <RecetteChip repo="/r/app" /> }])} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
