// An unknown key on a card write is a 400 that names the key meant, never a silent drop: the brief an
// orchestrator sent as `description` became a card with `spec: null` and a 200.
import { describe, expect, it } from "bun:test";

import { handleBoardRoute, parseCardBody } from "./board-routes.ts";
import { CARD_BODY_FIELDS, closestCardField, createWarnings, unknownCardFields } from "./card-fields.ts";
import { BoardDb } from "./db.ts";

function routeCtx(store: BoardDb) {
  return {
    db: store,
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: { busy: () => new Set<string>(), reformulate: () => {} },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }),
    text: (body: string, status: number) => new Response(body, { status }),
  } as never;
}

const send = (store: BoardDb, method: string, path: string, body: unknown) =>
  handleBoardRoute(
    path,
    new Request(`http://x${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    routeCtx(store),
  ).then((r) => r!);

/** One valid value per accepted field — create-only `category` aside, every one is also a PATCH field. */
const EVERY_FIELD: Record<(typeof CARD_BODY_FIELDS)[number], unknown> = {
  title: "ship it",
  spec: "the brief",
  rawInput: "a braindump",
  acceptance: ["it ships"],
  status: "ready",
  position: 3,
  repoPath: "/repo",
  baseRef: "main",
  branch: "board/ship-it",
  agentKind: "claude",
  parentId: null,
  dependsOn: null,
  duplicateOf: null,
  phaseId: null,
  templateId: null,
  pipelineId: null,
  assignee: "dev@example.org",
  tag: "infra",
  keepWorktree: true,
  category: "explore",
  environment: null,
  autoHandoff: "off",
  capability: "Lancer une carte",
  usageGroup: "Piloter",
  manualChecks: [{ text: "Ouvrir la carte", expected: "elle s'affiche" }],
};

describe("unknownCardFields — the hint", () => {
  it("points a brief sent under another name at spec, without accepting it", () => {
    for (const k of ["description", "Description", "body", "brief", "details"]) {
      expect(unknownCardFields({ [k]: "x" })).toBe(`unknown field "${k}" — did you mean "spec"?`);
    }
  });

  it("suggests the nearest field for a typo or another casing", () => {
    expect(closestCardField("acceptence")).toBe("acceptance");
    expect(closestCardField("repo_path")).toBe("repoPath");
    expect(closestCardField("depends_on")).toBe("dependsOn");
    expect(closestCardField("tags")).toBe("tag");
  });

  it("suggests nothing when nothing is close", () => {
    expect(unknownCardFields({ zzzzzzzz: 1 })).toBe('unknown field "zzzzzzzz"');
  });

  it("says a derived field is derived rather than mistyped", () => {
    expect(unknownCardFields({ origin: "agent" })).toContain("derived by the bridge");
  });

  it("names every unknown key, and none when there is none", () => {
    expect(unknownCardFields({ title: "x", description: "a", foo: 1 })).toBe(
      'unknown field "description" — did you mean "spec"?; unknown field "foo"',
    );
    expect(unknownCardFields({ title: "x", spec: "y" })).toBeNull();
  });
});

describe("parseCardBody — the accepted set is exactly CARD_BODY_FIELDS", () => {
  it("accepts every listed field on a create", () => {
    const parsed = parseCardBody(EVERY_FIELD, { requireTitle: true });
    expect(parsed).toMatchObject({ ok: true });
    // Every field reaches the parsed value: one listed here and not read by the parser would be lost.
    expect(Object.keys(parsed.ok ? parsed.value : {}).sort()).toEqual([...CARD_BODY_FIELDS].sort());
  });

  it("accepts every listed field but category on a patch", () => {
    const { category: _category, ...patch } = EVERY_FIELD;
    expect(parseCardBody(patch, { requireTitle: false })).toMatchObject({ ok: true });
  });
});

describe("POST /api/cards and PATCH /api/cards/<id> — unknown fields", () => {
  it("refuses a create carrying `description`, with the hint, and writes nothing", async () => {
    const store = new BoardDb(":memory:");
    const res = await send(store, "POST", "/api/cards", { title: "t", description: "the brief" });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('unknown field "description" — did you mean "spec"?');
    expect(store.listCards()).toHaveLength(0);
  });

  it("refuses a patch carrying `description`, and leaves the card alone", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "t", spec: "kept" });
    const res = await send(store, "PATCH", `/api/cards/${card.id}`, { description: "lost" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('did you mean "spec"?');
    expect(store.getCard(card.id)!.spec).toBe("kept");
  });

  it("still takes every known field on POST and on PATCH", async () => {
    const store = new BoardDb(":memory:");
    const created = await send(store, "POST", "/api/cards", EVERY_FIELD);
    expect(created.status).toBe(200);
    const { card } = (await created.json()) as { card: { id: string } };
    const stored = store.getCard(card.id)!;
    expect(stored.spec).toBe("the brief");
    expect(stored.capability).toBe("Lancer une carte");
    expect(stored.manualChecks.map((c) => c.text)).toEqual(["Ouvrir la carte"]);

    const { category: _category, title: _title, ...patch } = EVERY_FIELD;
    const patched = await send(store, "PATCH", `/api/cards/${card.id}`, { ...patch, spec: "rewritten", status: "backlog" });
    expect(patched.status).toBe(200);
    expect(store.getCard(card.id)!.spec).toBe("rewritten");
  });
});

describe("POST /api/cards — a card with no brief", () => {
  const WARNING = "card has no spec: the agent will start with only its title and acceptance";

  it("is created, with a warning beside it", async () => {
    const store = new BoardDb(":memory:");
    const res = await send(store, "POST", "/api/cards", { title: "t", acceptance: ["a"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; warnings?: string[] };
    expect(body.ok).toBe(true);
    expect(body.warnings).toEqual([WARNING]);
    expect(store.listCards()).toHaveLength(1);
  });

  it("carries no warning with a spec, or with a rawInput the copilot will turn into one", async () => {
    const store = new BoardDb(":memory:");
    const withSpec = (await (await send(store, "POST", "/api/cards", { title: "t", spec: "s" })).json()) as { warnings?: string[] };
    expect(withSpec.warnings).toBeUndefined();
    expect(createWarnings({ spec: null, rawInput: "dictated" })).toEqual([]);
    expect(createWarnings({ spec: null, rawInput: null })).toEqual([WARNING]);
  });
});
