import { setPreference, t } from "@/i18n";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { CardRoute } from "./card.tsx";
import { CARD_STATUS_LABEL, type BoardEvent, type CardDetail, type CardSession, type CardStatus, type CardView, type Review } from "@/lib/board";
import type { CardData } from "@/lib/board-loaders";

// The card's page was rebuilt into panels, one face per state (pas lancée, en cours, arrêtée, finie).
// The operator's rule: no feature may disappear. Each face is mounted with a card that has
// everything, and every gesture of the inventory that applies to that face must be found — on the
// page, or in its « Actions » menu.

const REPO = "/r/proj";
const runtime = { paneId: "w1:p1", agent: "claude", agentStatus: "idle" as const, cwd: "/w", workspaceId: "w1", workspaceLabel: "w" };
const ev = (id: number, type: string, payload: unknown = {}): BoardEvent => ({ id, cardId: "c1", type, payload, ts: Date.now() - (100 - id) * 60_000 });

function cardOf(status: CardStatus, extra: Partial<CardView> = {}): CardView {
  return {
    id: "c1",
    title: "The card",
    spec: "Do the thing.",
    rawInput: null,
    acceptance: ["Columns in French", "Phone conform"],
    status,
    repoPath: REPO,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    duplicateOf: null,
    dependsOn: null,
    origin: null,
    originCardId: null,
    category: null,
    tag: "ui",
    position: 0,
    createdAt: Date.now() - 3600_000,
    updatedAt: Date.now() - 600_000,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    autoHandoff: null,
    ...extra,
  };
}

const session = (extra: Partial<CardSession> = {}): CardSession => ({
  id: "s1",
  cardId: "c1",
  paneId: "w1:p1",
  agentSessionId: null,
  agentKind: "claude",
  ctxTokens: 50_000,
  ctxPct: 40,
  handoffMd: null,
  outcome: null,
  handoffRequestedAt: null,
  autoHandoffAt: null,
  startedAt: Date.now() - 1800_000,
  endedAt: null,
  ...extra,
});

const review = (id: string, verdict: string, createdAt: number, todos: Review["todos"] = []): Review => ({
  id,
  cardId: "c1",
  sessionId: "s1",
  verdict,
  notes: `Notes of ${id}`,
  todos,
  createdAt,
});

function detailOf(card: CardView, extra: Partial<CardDetail> = {}): CardDetail {
  return {
    card,
    predecessor: { id: "d1", title: "Before it", status: "done" },
    parent: { id: "p1", title: "The container", status: "backlog" },
    originCard: null,
    duplicate: null,
    children: [],
    sessions: [],
    reviews: [],
    events: [
      ev(1, "card.created"),
      ev(2, "card.edited", { replaced: { spec: "Old spec" } }),
    ],
    awaiting: { id: "q1", text: "Which one?" },
    ...extra,
  };
}

let integration: unknown = null;
beforeEach(() => {
  setPreference("fr");
  integration = null;
  server.use(
    http.get("/api/templates", () =>
      HttpResponse.json({ templates: [{ id: "t1", key: null, name: "Implementer", description: "", agentKind: null, model: null, brief: "", builtin: true, worker: true }], modelKinds: [] }),
    ),
    http.get("/api/flows", () => HttpResponse.json({ flows: [{ id: "f1", key: null, name: "Code", description: "", steps: ["t1"], builtin: true }] })),
    http.get("/api/repos/environments", () => HttpResponse.json({ remote: null, environments: [{ peer: "box", name: "dev", agent: "claude" }], unreachable: [] })),
    http.get("/api/repos/model", () =>
      HttpResponse.json({ harnesses: [{ kind: "claude", provider: false, providers: [], value: { provider: null, model: "Opus 5.5", effort: "medium" } }] }),
    ),
    http.get("/api/phases", () => HttpResponse.json({ phases: [] })),
    http.get("/api/cards", () => HttpResponse.json({ cards: [] })),
    http.get("/api/panes/migrate-hc", () => HttpResponse.json({ available: true })),
    http.get(/\/api\/cards\/[^/]+\/integration$/, () => HttpResponse.json({ integration })),
    http.get(/\/api\/cards\/[^/]+\/pr$/, () => HttpResponse.json({ pr: null })),
    http.get(/\/api\/cards\/[^/]+\/deliverables$/, () =>
      HttpResponse.json({ deliverables: [{ name: "capture.png", size: 10, mime: "image/png", publishedAt: Date.now(), by: "agent" }] }),
    ),
    http.get("/api/recette", () =>
      HttpResponse.json({
        groups: [
          {
            usage: null,
            entries: [
              {
                cardId: "c1",
                capability: "x",
                repoPath: REPO,
                assignee: null,
                state: "todo",
                followUpDone: false,
                shots: [],
                deliveredAt: 0,
                phase: null,
                lot: null,
                steps: [{ id: "k1", text: "Open the page on the phone", verdict: null }],
              },
            ],
          },
        ],
      }),
    ),
  );
});
afterEach(() => setPreference("en"));

async function mount(detail: CardDetail) {
  const router = createMemoryRouter(
    [{ path: "/card/:cardId", loader: (): CardData => ({ cardId: "c1", detail, error: false, authError: false }), element: <CardRoute /> }],
    { initialEntries: ["/card/c1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "The card" });
}

/** Found anywhere: a button or link by its name, a labelled control, or a text. */
function present(name: string | RegExp): boolean {
  return (
    screen.queryAllByRole("button", { name }).length > 0 ||
    screen.queryAllByRole("link", { name }).length > 0 ||
    screen.queryAllByLabelText(name).length > 0 ||
    screen.queryAllByText(name).length > 0
  );
}

/**
 * Waits for the async panels and opens the full journal, reads the page; then opens « Actions » (a
 * modal: it hides the page from the queries) and reads what was not on the page there. Returns what
 * is in neither.
 */
async function missing(inventory: Record<string, string | RegExp>): Promise<string[]> {
  await screen.findAllByText("capture.png");
  await userEvent.click(screen.getByRole("button", { name: t("fiche.history.journal") }));
  // Give the once-per-card reads (integration, model, recette, migrate) their tick.
  await new Promise((r) => setTimeout(r, 50));
  const notOnPage = Object.entries(inventory).filter(([, name]) => !present(name));
  await userEvent.click(screen.getByRole("button", { name: t("fiche.actions") }));
  await screen.findByRole("dialog");
  return notOnPage.filter(([, name]) => !present(name)).map(([what]) => what);
}

// Everything about the card as a whole, reachable from every face.
const everywhere = () => ({
  "statut": CARD_STATUS_LABEL.ready,
  "étiquette": "ui",
  "t'attend": t("awaiting.tag"),
  "épingler": t("pin.add"),
  "Actions": t("fiche.actions"),
  "éditer": t("card.edit"),
  "copier le prompt": /\/collie-board card c1/,
  "supprimer": t("card.danger.delete"),
  "Modifier (panneau)": t("fiche.modify"),
  "Reformuler": t("card.reformulate"),
  "Corriger avec le copilote": t("card.correct"),
  "historique": t("fiche.history"),
  "journal complet": t("fiche.history.hideJournal"),
  "restaurer une version": t("journal.restore"),
  "livrables": "capture.png",
});

describe("the card's page keeps every gesture, on each of its four faces", () => {
  it("pas lancée: what is asked, links, history, then launch and move", async () => {
    await mount(detailOf(cardOf("ready"), { lot: { id: "l1", repoPath: REPO, phaseId: null, name: "Lot A", position: 0, launchedAt: null, cardIds: ["c1"] } }));
    const inv = {
      ...everywhere(),
      "ajouter un critère": t("fiche.criteria.add"),
      "part de / après": t("fiche.link.partOf"),
      "changer un lien": t("fiche.link.change"),
      "nouvelle sous-carte": t("card.sub.new"),
      "lier une carte": t("card.sub.link"),
      "agent": t("agentpicker.label"),
      "modèle du dépôt": t("fiche.repoModel", { model: "Opus 5.5, moyen" }),
      "gabarit": t("templates.picker.label"),
      "gérer les gabarits": t("templates.manageLink"),
      "flow": t("flows.picker.label"),
      "machine": t("cardEnv.label"),
      "lancer": t("card.start.start"),
      "convertir": t("card.convert"),
      "ouvrir le lot": t("lot.open"),
      "déplacer": t("fiche.move"),
      "haut de colonne": t("card.toTop"),
    };
    expect(await missing(inv)).toEqual([]);
  });

  it("en cours: the agent first, then what it changed; what is asked and the relay on the right", async () => {
    integration = { branch: "board/x", base: "main", ahead: 2, behind: 0, baseDirty: false, branchDirty: false, baseCheckedOut: true, pushed: false };
    const c = cardOf("review", {
      runtime,
      session: session(),
      sessionCount: 1,
      branch: "board/x",
      nextStep: { templateId: "t2", name: "Relecteur" },
    });
    await mount(
      detailOf(c, {
        sessions: [session()],
        reviews: [review("r1", "partial", 1, [{ title: "Rename the label", card: null, tiny: { spec: "Rename it", acceptance: [], doneAt: null } }])],
        events: [ev(1, "card.created"), ev(2, "card.edited", { replaced: { spec: "Old" } }), ev(3, "session.opened")],
      }),
    );
    const inv = {
      ...everywhere(),
      "statut": CARD_STATUS_LABEL.review,
      "prise en main": t("held.take"),
      "ouvrir l'agent": t("fiche.agent.open"),
      "jauge": t("gauge.context"),
      "consigne à l'agent": t("card.prompt.send"),
      "étape suivante": t("card.nextStep", { name: "Relecteur" }),
      "passe de revue": t("card.pass.simplify"),
      "demander le commit": t("card.commit.ask"),
      "passer la main": t("card.handoff.do"),
      "migrer vers herdr-core": t("card.migrateHc.do"),
      "relais auto": t("card.autoHandoff.always"),
      "diff (rafraîchir)": t("diff.refresh"),
      "relancer la revue": t("card.review.again"),
      "finir maintenant": t("card.tiny.finish"),
      "intégration: garder le worktree": t("int.keep"),
      "intégration: ouvrir une PR": t("int.openPrDone"),
      "intégration: jeter": t("int.discard"),
      "déplacer": t("fiche.move"),
      "haut de colonne": t("card.toTop"),
      "sessions": t("card.section.sessions"),
    };
    expect(await missing(inv)).toEqual([]);
  });

  it("arrêtée: why in plain words with the ways out, reviews, history", async () => {
    integration = { branch: "board/x", base: "main", ahead: 2, behind: 0, baseDirty: false, branchDirty: false, baseCheckedOut: true, pushed: false };
    const c = cardOf("blocked", { branch: "board/x", sessionCount: 2 });
    const halted = ev(5, "run.halted", { reason: "GitHub answered 502 Bad Gateway" });
    await mount(
      detailOf(c, {
        sessions: [session({ endedAt: 1, outcome: "handoff", handoffMd: "Note" }), session({ id: "s2", endedAt: 2, outcome: "lost" })],
        reviews: [review("r1", "partial", 1), review("r2", "complete", 2)],
        reportEvents: [ev(4, "run.report", { text: "Did it", round: 1 }), halted],
        events: [ev(1, "card.created"), ev(2, "card.edited", { replaced: { spec: "Old" } }), halted],
      }),
    );
    expect(screen.getByRole("region", { name: t("fiche.why") })).toHaveTextContent("502 Bad Gateway");
    const inv = {
      ...everywhere(),
      "statut": CARD_STATUS_LABEL.blocked,
      "pourquoi": t("fiche.why"),
      "relancer sur sa branche": t("card.start.relaunch"),
      "merger": t("int.mergeDone", { base: "main" }),
      "ouvrir une PR et finir": t("int.openPrDone"),
      "jeter ce travail": t("int.discard"),
      "relancer la revue": t("card.review.again"),
      "revues précédentes": t("fiche.reviews.previous", { count: 1 }),
      "tours avec le lead": t("fiche.history.rounds.title"),
      "sessions": t("card.section.sessions"),
      "déplacer": t("fiche.move"),
      "haut de colonne": t("card.toTop"),
    };
    expect(await missing(inv)).toEqual([]);
  });

  it("arrêtée, orpheline: the non-nominal panel says so", async () => {
    await mount(detailOf(cardOf("orphaned", { sessionCount: 1 })));
    expect(await screen.findAllByText(t("card.orphan.title"))).not.toHaveLength(0);
  });

  it("finie: the agent in one line, the bilan, criteria with their verdict, recette and code", async () => {
    const c = cardOf("done", { sessionCount: 1, prUrl: "https://github.com/o/r/pull/7" });
    await mount(
      detailOf(c, {
        sessions: [session({ endedAt: 2, outcome: "done", handoffMd: "1. Columns in French: met, see test\n2. Phone conform: partly met, not seen" })],
        reviews: [review("r1", "complete", 2, [{ title: "Follow-up", card: { id: "f1", title: "Follow-up card", status: "backlog" } }])],
        reportEvents: [ev(4, "run.report", { text: "All done", round: 1 }), ev(5, "run.decision", { decision: "finished", reason: "Rewritten and committed, gate green" })],
        events: [ev(1, "card.created"), ev(2, "card.edited", { replaced: { spec: "Old" } }), ev(6, "card.pr_opened", { url: "https://github.com/o/r/pull/7" })],
      }),
    );
    const inv = {
      ...everywhere(),
      "statut": CARD_STATUS_LABEL.done,
      "l'agent": t("fiche.agent"),
      "bilan": t("fiche.bilan"),
      "verdict du lead": "Rewritten and committed, gate green",
      "pas fait": t("fiche.bilan.notDone"),
      "à vérifier": t("fiche.bilan.toCheck"),
      "rapports complets": t("fiche.bilan.reports"),
      "relancer la revue": t("card.review.again"),
      "critère atteint": t("fiche.verdict.met"),
      "critère en partie": t("fiche.verdict.partial"),
      "compte des critères": t("fiche.criteria.met", { met: 1, total: 2 }),
      "recette": t("fiche.recette"),
      "lien PR": /#7/,
      "déplacer": t("fiche.move"),
      "haut de colonne": t("card.toTop"),
      "sessions": t("card.section.sessions"),
    };
    expect(await missing(inv)).toEqual([]);
  });
  it("en cours dans un lot lancé: the lot's box, and the integration one tap away (take over)", async () => {
    integration = { branch: "board/x", base: "main", ahead: 2, behind: 0, baseDirty: false, branchDirty: false, baseCheckedOut: true, pushed: false };
    const lot = { id: "l1", repoPath: REPO, phaseId: null, name: "Lot A", position: 0, launchedAt: 1, cardIds: ["c1"] };
    await mount(detailOf(cardOf("working", { runtime, session: session(), sessionCount: 1, branch: "board/x" }), { lot }));
    expect(screen.getByRole("button", { name: t("lot.open") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("int.discard") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("lot.takeOver") }));
    expect(await screen.findByRole("button", { name: t("int.discard") })).toBeInTheDocument();
  });
});
