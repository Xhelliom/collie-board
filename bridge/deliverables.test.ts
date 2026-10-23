import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import type { Config } from "./config.ts";
import { BoardDb } from "./db.ts";
import { canSymlink } from "../scripts/test-env.ts";
import {
  deliverablesRoot,
  handleDeliverablesRoute,
  MAX_DELIVERABLE_BYTES,
  PUBLISHED_EVENT,
  sanitizeName,
  servedAs,
  suffixed,
  sweepOrphanDeliverables,
} from "./deliverables.ts";

// Against a real directory, like gallery.test.ts: what the store serves is decided by what the
// filesystem does with a symlink, which a fake fs would only agree with.

let stateDir: string;
let outside: string;
const db = new BoardDb(":memory:");
const ctx = () =>
  ({
    db,
    cfg: { stateDir } as Config,
    guard: () => null,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    text: (body: string, status: number) => new Response(body, { status }),
    audit: { record: () => {} },
    session: "s",
    device: null,
  }) as never;
const call = (path: string, init?: RequestInit, query = "") =>
  handleDeliverablesRoute(path, new Request(`http://x${path}${query}`, init), ctx()) as Promise<Response>;
const publish = (cardId: string, name: string, body: BodyInit, headers: Record<string, string> = {}) =>
  call(`/api/cards/${cardId}/deliverables`, { method: "POST", body, headers }, `?name=${encodeURIComponent(name)}`);

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "collie-deliv-"));
  outside = await mkdtemp(join(tmpdir(), "collie-secret-"));
  await writeFile(join(outside, "secret.txt"), "secret");
});
afterAll(async () => {
  await rm(stateDir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("sanitizeName", () => {
  test("keeps a plain name, takes the basename of a path, refuses what is left of nothing", () => {
    expect(sanitizeName("report.pdf")).toBe("report.pdf");
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("C:\\x\\shot.png")).toBe("shot.png");
    expect(sanitizeName("a$b;c.png")).toBe("a_b_c.png");
    expect(sanitizeName(".hidden")).toBe("hidden");
    expect(sanitizeName("..")).toBeNull();
    expect(sanitizeName("")).toBeNull();
    expect(sanitizeName("dir/")).toBeNull();
  });
  test("caps the length and keeps the extension", () => {
    const n = sanitizeName(`${"a".repeat(300)}.png`)!;
    expect(n.length).toBe(120);
    expect(n.endsWith(".png")).toBe(true);
  });
  test("suffixes before the extension", () => {
    expect(suffixed("a.png", 2)).toBe("a-2.png");
    expect(suffixed("Makefile", 3)).toBe("Makefile-3");
  });
});

describe("servedAs", () => {
  test("by extension: images inline, md, html, pdf, everything else an attachment", () => {
    expect(servedAs("a.PNG")).toEqual({ kind: "image", mime: "image/png" });
    expect(servedAs("a.md").kind).toBe("markdown");
    expect(servedAs("a.htm").kind).toBe("html");
    expect(servedAs("a.pdf").kind).toBe("pdf");
    expect(servedAs("a.xlsx").kind).toBe("attachment");
    expect(servedAs("a.svg").kind).toBe("attachment");
  });
});

describe("the routes", () => {
  test("publish, list, serve — with the provenance derived from the pane header", async () => {
    const card = db.createCard({ title: "c" });
    let res = await publish(card.id, "shot.png", new Uint8Array([1, 2, 3]), { "x-collie-pane": "p1" });
    expect(await res.json()).toMatchObject({ ok: true, name: "shot.png", size: 3 });
    res = await publish(card.id, "shot.png", new Uint8Array([4]));
    expect((await res.json()).name).toBe("shot-2.png");

    const list = (await (await call(`/api/cards/${card.id}/deliverables`)).json()).deliverables;
    expect(list.map((d: { name: string; by: string }) => [d.name, d.by]).sort()).toEqual([
      ["shot-2.png", "operator"],
      ["shot.png", "agent"],
    ]);
    expect(db.listEvents(card.id).some((e) => e.type === PUBLISHED_EVENT)).toBe(true);

    res = await call(`/api/cards/${card.id}/deliverables/shot.png`);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("serves each kind under its headers", async () => {
    const card = db.createCard({ title: "kinds" });
    await publish(card.id, "page.html", "<p>hi</p><script>alert(1)</script>");
    await publish(card.id, "doc.pdf", "%PDF-1.4");
    await publish(card.id, "sheet.xlsx", "PK");
    let res = await call(`/api/cards/${card.id}/deliverables/page.html`);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(await res.text()).not.toContain("<script");
    res = await call(`/api/cards/${card.id}/deliverables/doc.pdf`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    res = await call(`/api/cards/${card.id}/deliverables/sheet.xlsx`);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sheet.xlsx"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("refuses SVG, an oversized body, an empty one, a missing name", async () => {
    const card = db.createCard({ title: "refusals" });
    expect((await publish(card.id, "x.svg", "<svg/>")).status).toBe(415);
    expect((await publish(card.id, "big.bin", new Uint8Array(MAX_DELIVERABLE_BYTES + 1))).status).toBe(413);
    expect((await publish(card.id, "e.txt", "")).status).toBe(400);
    expect((await publish(card.id, "..", "x")).status).toBe(400);
    expect((await publish("no-such-card", "a.txt", "x")).status).toBe(404);
  });

  test("a crafted name never leaves the store", async () => {
    const card = db.createCard({ title: "crafted" });
    expect((await call(`/api/cards/${card.id}/deliverables/%2e%2e%2f%2e%2e%2fboard.db`)).status).toBe(404);
    expect((await call(`/api/cards/${card.id}/deliverables/..`)).status).toBe(404);
  });

  test.skipIf(!canSymlink)("a symlink never leaves the store", async () => {
    const card = db.createCard({ title: "escape" });
    const dir = join(deliverablesRoot(stateDir), card.id);
    await mkdir(dir, { recursive: true });
    await symlink(join(outside, "secret.txt"), join(dir, "leak.txt"));
    expect((await call(`/api/cards/${card.id}/deliverables/leak.txt`)).status).toBe(404);
    // The symlink is not listed either, and a publish under its name does not write through it.
    expect((await (await call(`/api/cards/${card.id}/deliverables`)).json()).deliverables).toEqual([]);
    expect((await (await publish(card.id, "leak.txt", "x")).json()).name).toBe("leak-2.txt");
    expect(await Bun.file(join(outside, "secret.txt")).text()).toBe("secret");
  });

  test("DELETE removes one; deleting the card removes its store; the boot sweep takes the orphans", async () => {
    const card = db.createCard({ title: "gone" });
    await publish(card.id, "a.md", "# a");
    expect((await call(`/api/cards/${card.id}/deliverables/a.md`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/api/cards/${card.id}/deliverables/a.md`)).status).toBe(404);
    expect(db.listEvents(card.id, 10).some((e) => e.type === "deliverable.deleted")).toBe(true);

    await publish(card.id, "b.md", "# b");
    const dir = join(deliverablesRoot(stateDir), card.id);
    const res = await handleBoardRoute(`/api/cards/${card.id}`, new Request(`http://x/api/cards/${card.id}`, { method: "DELETE" }), ctx());
    expect(res?.status).toBe(200);
    expect(existsSync(dir)).toBe(false);

    await mkdir(join(deliverablesRoot(stateDir), "orphan"), { recursive: true });
    expect(await sweepOrphanDeliverables(stateDir, (id) => db.getCard(id) !== null)).toEqual(["orphan"]);
  });
});
