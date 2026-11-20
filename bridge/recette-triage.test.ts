import { describe, expect, test } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";

const REPO = "/r/app";
const Q = `/api/recette/triage?repo=${REPO}`;

function board(): BoardDb {
  let t = Date.now();
  return new BoardDb(":memory:", () => t++);
}

function call(db: BoardDb, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const ctx = {
    db,
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: { busy: () => new Set<string>(), reformulate: () => {} },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }),
    text: (b: string, status: number) => new Response(b, { status }),
  } as never;
  const req = new Request(`http://x${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return handleBoardRoute(new URL(req.url).pathname, req, ctx) as Promise<Response>;
}

function delivered(db: BoardDb, title: string, steps: string[]) {
  const card = db.createCard({ title, repoPath: REPO });
  db.patchCard(card.id, { capability: title, usageGroup: "Usage", manualChecks: steps.map((text, i) => ({ id: `s${i}`, text })) });
  db.setStatus(card.id, "done", "test");
  return db.getCard(card.id)!;
}

type Entry = { cardId: string; capability: string; state: string; members?: { cardId: string }[]; obsolete?: { reason: string; replacedBy: { cardId: string; title: string }[] }; steps: { id: string; cardId: string; verdict: { status: string; note?: string } | null }[] };
const entries = async (db: BoardDb) =>
  ((await (await call(db, "GET", `/api/recette?repo=${REPO}&all=1`)).json()) as { groups: { entries: Entry[] }[] }).groups.flatMap((g) => g.entries);
const todo = async (db: BoardDb) => (await entries(db)).filter((e) => e.state === "todo").length;

describe("recette triage", () => {
  test("propose, apply, undo: obsolete skipped with its reason, a group read as one entry, nothing lost", async () => {
    const db = board();
    const old = delivered(db, "Ancien écran", ["a", "b"]);
    const neu = delivered(db, "Nouvel écran", ["c"]);
    const g1 = delivered(db, "Geste 1", ["d", "e"]);
    const g2 = delivered(db, "Geste 2", ["f"]);
    // A verdict given before the triage stays the operator's: the triage does not overwrite it.
    db.setCheckVerdict(old.id, "s0", { status: "ok", by: "operator", at: 1 });
    db.setCheckVerdict(g2.id, "s0", { status: "ok", by: "operator", at: 1 });
    expect(await todo(db)).toBe(3); // Geste 2 is already OK

    const proposal = {
      obsolete: [
        { cardId: old.id, reason: "écran refait", replacedBy: [neu.id] },
        { cardId: g1.id, stepId: "s1", reason: "bouton retiré", replacedBy: [neu.id] },
      ],
      groups: [{ usage: "Usage", title: "Les gestes", cardIds: [g1.id, g2.id] }],
    };
    expect((await call(db, "PUT", Q, { ...proposal, groups: [{ title: "x", cardIds: [g1.id, "nope"] }] })).status).toBe(400);
    expect((await call(db, "PUT", Q, proposal, { "x-collie-pane": "p1" })).status).toBe(200); // an agent may propose
    const got = (await (await call(db, "GET", Q)).json()) as { triage: { summary: Record<string, number>; applied: unknown } };
    expect(got.triage.summary).toEqual({ obsolete: 1, obsoleteSteps: 1, groups: 1, grouped: 2 });
    expect(got.triage.applied).toBeNull();

    // The operator's gesture only.
    expect((await call(db, "POST", Q, {}, { "x-collie-pane": "p1" })).status).toBe(403);
    expect((await call(db, "DELETE", Q, {}, { "x-collie-pane": "p1" })).status).toBe(403);
    expect((await call(db, "POST", Q, {})).status).toBe(200);
    expect((await call(db, "POST", Q, {})).status).toBe(409);

    const after = await entries(db);
    expect(await todo(db)).toBe(2); // the new screen + the folded group
    const ob = after.find((e) => e.cardId === old.id)!;
    expect(ob.state).toBe("ok");
    expect(ob.obsolete).toEqual({ reason: "écran refait", replacedBy: [{ cardId: neu.id, title: "Nouvel écran" }] });
    expect(ob.steps[0]!.verdict!.status).toBe("ok");
    expect(ob.steps[1]!.verdict).toMatchObject({ status: "skip", note: "caduque — remplacée par « Nouvel écran » : écran refait" });
    const group = after.find((e) => e.cardId === g1.id)!;
    expect(after.some((e) => e.cardId === g2.id)).toBe(false);
    expect(group.capability).toBe("Les gestes");
    expect(group.members!.map((m) => m.cardId)).toEqual([g1.id, g2.id]);
    expect(group.steps.map((s) => [s.cardId, s.id, s.verdict?.status ?? null])).toEqual([
      [g1.id, "s0", null],
      [g1.id, "s1", "skip"],
      [g2.id, "s0", "ok"],
    ]);

    // A skip the operator changed since is theirs: undo keeps it.
    db.setCheckVerdict(old.id, "s1", { status: "ko", by: "operator", at: 2 });
    expect((await call(db, "DELETE", Q)).status).toBe(200);
    const back = await entries(db);
    expect(back.length).toBe(4);
    expect(back.find((e) => e.cardId === g1.id)!.steps.map((s) => s.verdict)).toEqual([null, null]);
    expect(back.find((e) => e.cardId === g2.id)!.steps[0]!.verdict!.status).toBe("ok");
    expect(back.find((e) => e.cardId === old.id)!.steps.map((s) => s.verdict!.status)).toEqual(["ok", "ko"]);
    expect(back.find((e) => e.cardId === old.id)!.obsolete).toBeUndefined();
  });

  test("a card in two places, or an unknown step, is refused", async () => {
    const db = board();
    const a = delivered(db, "A", ["x"]);
    const b = delivered(db, "B", ["y"]);
    expect((await call(db, "PUT", Q, { obsolete: [{ cardId: a.id, reason: "r", replacedBy: [b.id] }], groups: [{ title: "g", cardIds: [a.id, b.id] }] })).status).toBe(400);
    expect((await call(db, "PUT", Q, { obsolete: [{ cardId: a.id, stepId: "zz", reason: "r", replacedBy: [b.id] }], groups: [] })).status).toBe(400);
    expect((await call(db, "POST", Q)).status).toBe(404);
  });
});
