// The Documents page: the repo's Markdown as it stands on its default branch, classed by the
// rubrics of the documentation convention (docs/conventions/DOC_CONVENTION.md §4). Read through
// bridge/git.ts only — ls-tree / cat-file / grep on the ref's tree, never a checkout, never a path
// off disk. Read when the page opens: no poll, no cache.

import type { BoardContext } from "./board-routes.ts";
import type { DecisionStatus } from "./db.ts";
import { defaultBranchOf, docsOnRef, grepDocsOnRef, isSafePageName, pagesOnRef, PAGES_DIR, readDocOnRef, type DocLine, type TreeDoc } from "./git.ts";
import { repoPathOf } from "./paths.ts";
import { redactText } from "./redact.ts";
import { scrubHtml } from "./scrub.ts";
import { repoRootOf } from "./repos.ts";

export const DOCS_ROUTE = "/api/docs";
const DOCS_FILE = "/api/docs/file";
const DOCS_SEARCH = "/api/docs/search";
const MAX_QUERY = 200;
const PAGES = "/api/docs/pages";
const PAGE = "/api/docs/page";

/**
 * The CSP of a custom page — its own, never the board's (that one is only set on the app's static
 * files, server.ts). `sandbox` without allowances: opaque origin, no script, no form, no navigation of
 * the board; `default-src 'none'`: nothing leaves — no fetch, no remote image, font or stylesheet.
 * Only the page's inline CSS and `data:` images/fonts render. ADR 0053.
 */
export const PAGE_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

export interface Rubric {
  id: string;
  label: string;
  /** Repo-relative; a folder ends with `/`. */
  paths: string[];
}

/**
 * The rubrics of a `json doc-paths` block: the socle, then every module's, one per id (a module that
 * repeats an id — `architecture` — adds its paths to it). Null when there is no valid block. Pure.
 */
export function parseDocPaths(md: string): Rubric[] | null {
  const block = /```json doc-paths\r?\n([\s\S]*?)\r?\n```/.exec(md)?.[1];
  if (!block) return null;
  let o: { socle?: unknown; modules?: Record<string, unknown> };
  try {
    o = JSON.parse(block);
  } catch {
    return null;
  }
  const lists = [o.socle, ...Object.values(o.modules ?? {})].filter(Array.isArray) as unknown[][];
  const out = new Map<string, Rubric>();
  for (const raw of lists.flat()) {
    const r = raw as Partial<Rubric>;
    if (typeof r.id !== "string" || typeof r.label !== "string" || !Array.isArray(r.paths)) continue;
    const paths = r.paths.filter((p): p is string => typeof p === "string");
    const had = out.get(r.id);
    if (had) had.paths.push(...paths.filter((p) => !had.paths.includes(p)));
    else out.set(r.id, { id: r.id, label: r.label, paths });
  }
  return out.size > 0 ? [...out.values()] : null;
}

/** The rubric a path belongs to, or null (« Autres »): a file by its exact path, a folder by prefix. Pure. */
export function rubricOf(path: string, rubrics: readonly Rubric[]): string | null {
  return rubrics.find((r) => r.paths.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p)))?.id ?? null;
}

export interface DocMeta {
  title: string | null;
  status: string | null;
  date: string | null;
}

/** The lines {@link docMeta} reads: the first `# ` heading, a `**Status:**`/`**Statut :**` and a `**Date:**` line. */
export const META_PATTERN = "^(# |\\*\\*(Status|Statut|Date) ?:)";

/** Each file's title, status and date, from the grep of {@link META_PATTERN}. First line of each wins. Pure. */
export function docMeta(lines: readonly DocLine[]): Map<string, DocMeta> {
  const out = new Map<string, DocMeta>();
  for (const l of [...lines].sort((a, b) => a.line - b.line)) {
    const m = out.get(l.path) ?? { title: null, status: null, date: null };
    out.set(l.path, m);
    const field = /^\*\*(Status|Statut|Date) ?:\*\*\s*(.*)$/.exec(l.text.trim());
    if (l.text.startsWith("# ")) m.title ??= l.text.slice(2).trim() || null;
    else if (field?.[1] === "Date") m.date ??= field[2]!.trim() || null;
    else if (field) m.status ??= field[2]!.trim() || null;
  }
  return out;
}

export type DocDecision =
  | { kind: "adr"; path: string; title: string; status: string | null; date: string | null }
  | { kind: "roadmap"; id: string; text: string; status: DecisionStatus; date: string | null };

/** ISO day of an epoch, for a roadmap decision (dated by its roadmap's last revision). Pure. */
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** ADRs and roadmap decisions, newest first; an undated one goes last. Pure. */
export function mergeDecisions(adrs: DocDecision[], roadmap: DocDecision[]): DocDecision[] {
  const key = (d: DocDecision) => d.date ?? "";
  return [...adrs, ...roadmap].sort((a, b) => key(b).localeCompare(key(a)));
}

export interface DocsIndex {
  ref: string;
  rubrics: { id: string; label: string; docs: { path: string; title: string; size: number }[] }[];
  /** Files no rubric claims — the page's « Autres ». */
  other: { path: string; title: string; size: number }[];
  decisions: DocDecision[];
}

/** Assemble the page from the tree, its meta lines and the roadmap's decisions. Pure. */
export function buildIndex(
  ref: string,
  docs: readonly TreeDoc[],
  lines: readonly DocLine[],
  rubrics: readonly Rubric[],
  roadmap: { decisions: { id: string; text: string; status: DecisionStatus }[]; updatedAt: number } | null,
): DocsIndex {
  const meta = docMeta(lines);
  const titled = (d: TreeDoc) => ({ path: d.path, title: meta.get(d.path)?.title ?? d.path.split("/").pop()!, size: d.size });
  const byRubric = new Map<string | null, ReturnType<typeof titled>[]>();
  for (const d of [...docs].sort((a, b) => a.path.localeCompare(b.path))) {
    const id = rubricOf(d.path, rubrics);
    byRubric.set(id, [...(byRubric.get(id) ?? []), titled(d)]);
  }
  const adrs: DocDecision[] = (byRubric.get("adr") ?? []).map((d) => ({
    kind: "adr",
    path: d.path,
    title: d.title,
    status: meta.get(d.path)?.status ?? null,
    date: meta.get(d.path)?.date ?? null,
  }));
  const day = roadmap ? isoDay(roadmap.updatedAt) : null;
  const fromRoadmap: DocDecision[] = (roadmap?.decisions ?? []).map((d) => ({ kind: "roadmap", id: d.id, text: d.text, status: d.status, date: day }));
  return {
    ref,
    rubrics: rubrics.filter((r) => byRubric.has(r.id)).map((r) => ({ id: r.id, label: r.label, docs: byRubric.get(r.id)! })),
    other: byRubric.get(null) ?? [],
    decisions: mergeDecisions(adrs, fromRoadmap),
  };
}

/** The convention shipped with the plugin. Missing or unreadable: no rubric, every file under « Autres ». */
async function defaultRubrics(): Promise<Rubric[]> {
  const file = Bun.file(new URL("../docs/conventions/DOC_CONVENTION.md", import.meta.url));
  return (await file.exists()) ? (parseDocPaths(await file.text()) ?? []) : [];
}

/** `docs/README.md` may declare the repo's own mapping in the same format (convention §4); it wins. */
async function rubricsFor(root: string, ref: string, docs: readonly TreeDoc[]): Promise<Rubric[]> {
  if (docs.some((d) => d.path === "docs/README.md")) {
    const own = await readDocOnRef(root, ref, "docs/README.md");
    const parsed = own && parseDocPaths(own.text);
    if (parsed) return parsed;
  }
  return defaultRubrics();
}

export async function handleDocsRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (![DOCS_ROUTE, DOCS_FILE, DOCS_SEARCH, PAGES, PAGE].includes(pathname)) return null;
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("read");
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const repo = repoPathOf(q.get("repo"));
  if (!repo) return ctx.text("repo must be an absolute path", 400);
  const root = await repoRootOf(repo).catch(() => null);
  if (!root) return ctx.text("not a git repository", 404);
  const ref = await defaultBranchOf(root).catch(() => undefined);
  if (!ref) return ctx.text("no default branch", 404);

  if (pathname === DOCS_FILE) {
    const path = q.get("path") ?? "";
    const doc = await readDocOnRef(root, ref, path);
    if (!doc) return ctx.text("no such document on the default branch", 404);
    return ctx.json({ ref, path, text: redactText(doc.text), truncated: doc.truncated });
  }

  if (pathname === PAGES) return ctx.json({ ref, pages: await pagesOnRef(root, ref) });

  if (pathname === PAGE) {
    const name = q.get("name") ?? "";
    const page = isSafePageName(name) ? await readDocOnRef(root, ref, `${PAGES_DIR}${name}.html`, undefined, /\.html$/) : null;
    if (!page) return ctx.text("no such page on the default branch", 404);
    // Agent HTML: scrubbed (scripts, frames, external styles, on* dropped), then inert under PAGE_CSP.
    return new Response(scrubHtml(redactText(page.text)), {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP, "cache-control": "no-store" },
    });
  }

  if (pathname === DOCS_SEARCH) {
    const query = (q.get("q") ?? "").trim();
    if (!query || query.length > MAX_QUERY) return ctx.text(`q must be 1..${MAX_QUERY} characters`, 400);
    return ctx.json({ ref, paths: (await grepDocsOnRef(root, ref, query, "paths")).map((l) => l.path) });
  }

  const docs = await docsOnRef(root, ref);
  if (!docs) return ctx.text("cannot read the default branch", 404);
  const [lines, rubrics] = await Promise.all([grepDocsOnRef(root, ref, META_PATTERN, "lines"), rubricsFor(root, ref, docs)]);
  return ctx.json(buildIndex(ref, docs, lines, rubrics, ctx.db.getRoadmap(repo)));
}
