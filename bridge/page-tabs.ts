import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { deliverablesRoot, listDeliverables, sanitizeName, servedAs } from "./deliverables.ts";
import { knownRepoRoot } from "./docs.ts";
import { defaultBranchOf, isSafePageName, pagesOnRef } from "./git.ts";
import { repoPathOf, samePath } from "./paths.ts";
import { listRepos, scanRootsFor } from "./repos.ts";

// Documents › Pages: every HTML page of a project the board can show — its docs/pages/*.html on the
// default branch and the HTML deliverables published on its cards — and which of them the operator put
// in the tab row. Nothing is a tab by default; the choice is the operator's, per repo (repo_pref).
// A page's key: its name for a docs page, `<cardId>/<file>` for a deliverable (neither holds a `/`).

export const PAGE_TABS_ROUTE = "/api/docs/page-tabs";
/** More tabs than this is not a tab row any more. */
const MAX_TABS = 40;

export interface CardPage {
  cardId: string;
  cardTitle: string;
  name: string;
  size: number;
}

/** A key the route accepts: a page name, or `<cardId>/<file.html>`. Pure + exported for the test. */
export function parsePageKey(key: string): { page: string } | { cardId: string; name: string } | null {
  const slash = key.indexOf("/");
  if (slash < 0) return isSafePageName(key) ? { page: key } : null;
  const cardId = key.slice(0, slash);
  const name = key.slice(slash + 1);
  if (!cardId || cardId.startsWith(".") || sanitizeName(name) !== name || servedAs(name).kind !== "html") return null;
  return { cardId, name };
}

/** The HTML deliverables of the repo's cards, archived ones included, newest first. */
async function cardPages(ctx: BoardContext, repo: string): Promise<CardPage[]> {
  const root = deliverablesRoot(ctx.cfg.stateDir);
  const stored = new Set(await readdir(root).catch(() => [] as string[]));
  const out: CardPage[] = [];
  for (const card of ctx.db.listCards({ includeArchived: true })) {
    if (!stored.has(card.id) || !card.repoPath || !samePath(card.repoPath, repo)) continue;
    for (const d of await listDeliverables(join(root, card.id)))
      if (servedAs(d.name).kind === "html") out.push({ cardId: card.id, cardTitle: card.title, name: d.name, size: d.size });
  }
  return out;
}

export async function handlePageTabsRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== PAGE_TABS_ROUTE) return null;
  if (req.method !== "GET" && req.method !== "PUT") return ctx.text("method not allowed", 405);
  const write = req.method === "PUT";
  if (write && req.headers.get("x-collie-pane")?.trim()) return ctx.text("the tab row is the operator's setting — an agent pane may not change it", 403);
  const denied = ctx.guard(write ? "write" : "read");
  if (denied) return denied;

  const body = write ? (((await req.json().catch(() => null)) ?? {}) as { repo?: unknown; key?: unknown; on?: unknown }) : null;
  const repo = repoPathOf(body ? body.repo : new URL(req.url).searchParams.get("repo"));
  if (!repo) return ctx.text("repo must be an absolute path", 400);
  const known = await listRepos(ctx.db, ctx.engine.current(), scanRootsFor(ctx.cfg.boardRepoRoots, homedir(), existsSync));
  const root = await knownRepoRoot(repo, known.map((r) => r.path));
  if (!root) return ctx.text("unknown repository: not one of the board's projects", 403);

  const ref = await defaultBranchOf(root).catch(() => undefined);
  const [pages, deliverables] = await Promise.all([ref ? pagesOnRef(root, ref) : [], cardPages(ctx, repo)]);
  const exists = new Set([...pages.map((p) => p.name), ...deliverables.map((d) => `${d.cardId}/${d.name}`)]);

  if (body) {
    const key = typeof body.key === "string" ? body.key : "";
    if (!parsePageKey(key)) return ctx.text("key must be a page name or <cardId>/<file.html>", 400);
    if (typeof body.on !== "boolean") return ctx.text("on must be a boolean", 400);
    if (body.on && !exists.has(key)) return ctx.text("no such page on this project", 404);
    const current = ctx.db.repoPageTabs(repo).filter((k) => k !== key);
    if (body.on && current.length >= MAX_TABS) return ctx.text(`at most ${MAX_TABS} pages in tabs`, 400);
    ctx.db.setRepoPageTabs(repo, body.on ? [...current, key] : current);
    ctx.audit.record({ action: "repo.page-tab", session: ctx.session, device: ctx.device, detail: { repo, key, on: body.on } });
  }
  // A ticked page that has gone (merged away, card deleted) is no tab: it is not offered, not stored over.
  return ctx.json({ ref: ref ?? null, pages, deliverables, tabs: ctx.db.repoPageTabs(repo).filter((k) => exists.has(k)) });
}
