import { describe, expect, test } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { Hlc } from "./journal.ts";
import { manualChecksPrompt, parseRecetteBody, recetteState } from "./recette.ts";
import { wrapupPrompt } from "./wrapup.ts";

const REPO = "/r/app";

function board(): BoardDb {
  let t = 1_000;
  return new BoardDb(":memory:", () => t++);
}

function ctx(db: BoardDb) {
  return {
    db,
    // The card view the PATCH answers with reads these; nothing here reaches herdr.
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: { busy: () => new Set<string>(), reformulate: () => {} },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }),
    text: (body: string, status: number) => new Response(body, { status }),
  } as never;
}

function call(db: BoardDb, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`http://x${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handleBoardRoute(new URL(req.url).pathname, req, ctx(db)) as Promise<Response>;
}

/** A delivered card carrying a two-step recette. */
function delivered(db: BoardDb, title = "route /api/node/launch") {
  const card = db.createCard({ title, repoPath: REPO });
  db.patchCard(card.id, {
    capability: "Lancer une carte sur dev depuis l'éditeur",
    usageGroup: "Piloter une autre machine",
    manualChecks: [
      { id: "a", text: "Choisir « dev » dans Environnement", expected: "le chip dev apparaît" },
      { id: "b", text: "Démarrer la carte", shot: "dev.png" },
    ],
  });
  db.setStatus(card.id, "done", "test");
  return db.getCard(card.id)!;
}

describe("parseRecetteBody", () => {
  test("a step without an id gets one from its text — rewording asks for a fresh verdict", () => {
    const r = parseRecetteBody({ manualChecks: ["Ouvrir la Recette", { text: "Ouvrir la Recette ", expected: "x" }] });
    expect(r.ok).toBe(false); // same text twice is the same step
    const a = parseRecetteBody({ manualChecks: ["Ouvrir la Recette"] });
    const b = parseRecetteBody({ manualChecks: ["Ouvrir la Recette"] });
    const c = parseRecetteBody({ manualChecks: ["Ouvrir la Recette du jour"] });
    if (!a.ok || !b.ok || !c.ok) throw new Error("refused");
    expect(a.value.manualChecks![0]!.id).toBe(b.value.manualChecks![0]!.id);
    expect(a.value.manualChecks![0]!.id).not.toBe(c.value.manualChecks![0]!.id);
  });

  test("a step is one line: over 100 chars is refused, as is a step with no text", () => {
    expect(parseRecetteBody({ manualChecks: ["x".repeat(101)] }).ok).toBe(false);
    expect(parseRecetteBody({ manualChecks: [{ text: "ok", expected: "y".repeat(101) }] }).ok).toBe(false);
    expect(parseRecetteBody({ manualChecks: [{ expected: "y" }] }).ok).toBe(false);
    expect(parseRecetteBody({ manualChecks: "nope" }).ok).toBe(false);
    expect(parseRecetteBody({ capability: 3 }).ok).toBe(false);
  });
});

describe("PATCH /api/cards/:id — manualChecks", () => {
  test("an agent pane may write its card's recette", async () => {
    const db = board();
    const card = db.createCard({ title: "t", repoPath: REPO });
    const res = await call(db, "PATCH", `/api/cards/${card.id}`, { capability: "Voir X", manualChecks: [{ text: "Ouvrir X", expected: "X s'affiche" }] }, { "x-collie-pane": "p1" });
    expect(res.status).toBe(200);
    const after = db.getCard(card.id)!;
    expect(after.capability).toBe("Voir X");
    expect(after.manualChecks).toEqual([{ id: expect.any(String), text: "Ouvrir X", expected: "X s'affiche" }]);
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { manualChecks: ["z".repeat(150)] })).status).toBe(400);
  });
});

describe("POST /api/cards/:id/checks/:step — the verdict", () => {
  test("refused to an agent pane: an agent does not pass its own recette", async () => {
    const db = board();
    const card = delivered(db);
    const res = await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "ok" }, { "x-collie-pane": "p1" });
    expect(res.status).toBe(403);
    expect(db.getCard(card.id)!.checkVerdicts).toEqual({});
  });

  test("by is derived — operator on an unshared repo, the pair's identity on a shared one, never the body", async () => {
    const db = board();
    const card = delivered(db);
    await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "ok", by: "someone@else" });
    expect(db.getCard(card.id)!.checkVerdicts.a).toMatchObject({ status: "ok", by: "operator" });
    db.setRepoShare(REPO, "origin");
    db.setPeerIdentity(REPO, "me@pair");
    await call(db, "POST", `/api/cards/${card.id}/checks/b`, { status: "skip" });
    expect(db.getCard(card.id)!.checkVerdicts.b).toMatchObject({ status: "skip", by: "me@pair" });
  });

  test("bad status, unknown step and unknown card are refused", async () => {
    const db = board();
    const card = delivered(db);
    expect((await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "maybe" })).status).toBe(400);
    expect((await call(db, "POST", `/api/cards/${card.id}/checks/zz`, { status: "ok" })).status).toBe(404);
    expect((await call(db, "POST", `/api/cards/nope/checks/a`, { status: "ok" })).status).toBe(404);
  });

  test("a KO with a note becomes a follow-up card linked back, at the operator's gesture only", async () => {
    const db = board();
    const card = delivered(db);
    expect((await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "ko", followUp: true })).status).toBe(400);
    const res = await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "ko", note: "rien ne s'affiche", followUp: true });
    const { followUp } = (await res.json()) as { followUp: { id: string } };
    const f = db.getCard(followUp.id)!;
    expect(f.originCardId).toBe(card.id);
    expect(f.repoPath).toBe(REPO);
    expect(f.spec).toContain("rien ne s'affiche");
    expect(f.origin).toBeNull();
  });
});

describe("GET /api/recette", () => {
  type Body = { groups: { usage: string | null; entries: { cardId: string; capability: string; state: string; steps: unknown[] }[] }[] };
  const read = async (db: BoardDb, q = "") => (await (await call(db, "GET", `/api/recette?repo=${REPO}${q}`)).json()) as Body;

  test("delivered cards with steps, titled by the capability and grouped by use; internal and undelivered ones absent", async () => {
    const db = board();
    const card = delivered(db);
    db.createCard({ title: "refacto interne", repoPath: REPO, status: "done" }); // no steps: internal
    const wip = db.createCard({ title: "en cours", repoPath: REPO });
    db.patchCard(wip.id, { manualChecks: [{ id: "x", text: "Ouvrir" }] });
    const body = await read(db);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.usage).toBe("Piloter une autre machine");
    expect(body.groups[0]!.entries.map((e) => [e.cardId, e.capability, e.state])).toEqual([[card.id, "Lancer une carte sur dev depuis l'éditeur", "todo"]]);
    expect(JSON.stringify(body)).not.toContain("/api/node/launch"); // the card's technical title is not the entry
  });

  test("fully validated cards are left out unless all=1; since filters by delivery", async () => {
    const db = board();
    const card = delivered(db);
    await call(db, "POST", `/api/cards/${card.id}/checks/a`, { status: "ok" });
    expect((await read(db)).groups[0]!.entries[0]!.state).toBe("todo");
    await call(db, "POST", `/api/cards/${card.id}/checks/b`, { status: "skip" });
    expect((await read(db)).groups).toEqual([]);
    expect((await read(db, "&all=1")).groups[0]!.entries[0]!.state).toBe("ok");
    expect((await read(db, `&all=1&since=${Date.now() + 60_000}`)).groups).toEqual([]);
    expect((await call(db, "GET", "/api/recette?since=nonsense")).status).toBe(400);
  });

  test("one KO marks the entry KO", () => {
    expect(recetteState({ manualChecks: [{ id: "a", text: "x" }, { id: "b", text: "y" }], checkVerdicts: { b: { status: "ko", by: "o", at: 1 } } })).toBe("ko");
  });
});

describe("the recette travels through the shared journal", () => {
  test("steps and verdicts are journaled as two fields, and applied on the other pair", async () => {
    const a = board();
    a.setRepoShare(REPO, "origin");
    const card = delivered(a);
    await call(a, "POST", `/api/cards/${card.id}/checks/a`, { status: "ko", note: "n" });
    const entries = a.journalOutbox(REPO, new Hlc("aaaaaaaaaaaa"), "a@pair");
    const fields = entries.flatMap((e) => Object.keys((e.event as { fields: Record<string, unknown> }).fields));
    expect(fields).toContain("manual_checks");
    expect(fields).toContain("check_verdicts");

    const b = board();
    b.setRepoShare(REPO, "origin");
    b.applyJournal(REPO, entries, new Hlc("bbbbbbbbbbbb"));
    const there = b.getCard(card.id)!;
    expect(there.manualChecks.map((s) => s.id)).toEqual(["a", "b"]);
    expect(there.checkVerdicts.a).toMatchObject({ status: "ko", note: "n" });
    expect(there.usageGroup).toBe("Piloter une autre machine");
  });
});

describe("the worker is asked for its recette", () => {
  test("in its closing report, with the card's id, and told to write nothing for internal work", () => {
    const card = board().createCard({ title: "t" });
    const prompt = wrapupPrompt(card);
    expect(prompt).toContain(manualChecksPrompt(card.id));
    expect(prompt).toContain(`/api/cards/${card.id}`);
    expect(manualChecksPrompt(card.id)).toContain("Purely internal work");
  });
});
