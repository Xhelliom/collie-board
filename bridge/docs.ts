// The Documents page: the repo's Markdown as it stands on its default branch, classed by the
// rubrics of the documentation convention (docs/conventions/DOC_CONVENTION.md §4). Read through
// bridge/git.ts only — ls-tree / cat-file / grep on the ref's tree, never a checkout, never a path
// off disk. Read when the page opens: no poll, no cache.

import type { BoardContext } from "./board-routes.ts";
import type { DecisionStatus } from "./db.ts";
import { defaultBranchOf, docsOnRef, grepDocsOnRef, isSafePageName, pagesOnRef, PAGES_DIR, readDocOnRef, type DocLine, type TreeDoc } from "./git.ts";
import { repoPathOf, samePath } from "./paths.ts";
import { redactText } from "./redact.ts";
import { scrubHtml } from "./scrub.ts";
import { listRepos, repoRootOf, scanRootsFor } from "./repos.ts";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

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
  /** The bilan counts it missing when no path holds a file. */
  required?: boolean;
}

export interface DocConvention {
  socle: Rubric[];
  modules: Record<string, Rubric[]>;
  maxFileBytes: number;
}

/** The size past which a file should be split (convention §1.9), when the block doesn't say. */
const MAX_FILE_BYTES = 30_000;

/** A block's rubric list, the malformed entries dropped. Pure. */
function rubricList(list: unknown): Rubric[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const r = raw as Partial<Rubric>;
    if (typeof r.id !== "string" || typeof r.label !== "string" || !Array.isArray(r.paths)) return [];
    return [{ id: r.id, label: r.label, paths: r.paths.filter((p): p is string => typeof p === "string"), ...(r.required === true && { required: true }) }];
  });
}

/** The `json doc-paths` block as written: socle, modules, size limit. Null when there is no valid block. Pure. */
export function parseDocConvention(md: string): DocConvention | null {
  const block = /```json doc-paths\r?\n([\s\S]*?)\r?\n```/.exec(md)?.[1];
  if (!block) return null;
  let o: { socle?: unknown; modules?: Record<string, unknown>; maxFileBytes?: unknown };
  try {
    o = JSON.parse(block);
  } catch {
    return null;
  }
  const modules = Object.fromEntries(Object.entries(o.modules ?? {}).map(([k, v]) => [k, rubricList(v)]));
  const maxFileBytes = typeof o.maxFileBytes === "number" && o.maxFileBytes > 0 ? o.maxFileBytes : MAX_FILE_BYTES;
  return { socle: rubricList(o.socle), modules, maxFileBytes };
}

/**
 * The rubrics of a convention: the socle, then every module's, one per id (a module that repeats an
 * id — `architecture` — adds its paths to it). Null when there is none. Pure.
 */
export function rubricsOf(c: DocConvention | null): Rubric[] | null {
  if (!c) return null;
  const out = new Map<string, Rubric>();
  for (const r of [c.socle, ...Object.values(c.modules)].flat()) {
    const had = out.get(r.id);
    if (had) had.paths.push(...r.paths.filter((p) => !had.paths.includes(p)));
    else out.set(r.id, { id: r.id, label: r.label, paths: [...r.paths] });
  }
  return out.size > 0 ? [...out.values()] : null;
}

/** The rubrics of a `json doc-paths` block (see {@link rubricsOf}). Pure. */
export const parseDocPaths = (md: string): Rubric[] | null => rubricsOf(parseDocConvention(md));

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

/** The convention shipped with the plugin. Missing or unreadable: null — no rubric, no bilan. */
async function defaultConvention(): Promise<DocConvention | null> {
  const file = Bun.file(new URL("../docs/conventions/DOC_CONVENTION.md", import.meta.url));
  return (await file.exists()) ? parseDocConvention(await file.text()) : null;
}

/** `docs/README.md` may declare the repo's own mapping in the same format (convention §4); it wins. */
async function conventionFor(root: string, ref: string, docs: readonly TreeDoc[]): Promise<DocConvention | null> {
  if (docs.some((d) => d.path === "docs/README.md")) {
    const own = await readDocOnRef(root, ref, "docs/README.md");
    const parsed = own && parseDocConvention(own.text);
    if (parsed && rubricsOf(parsed)) return parsed;
  }
  return defaultConvention();
}

/** One gap to the convention, one line on the page (worded by the client, so it is translated). */
export type BilanIssue =
  | { code: "missing"; rubric: string; label: string }
  | { code: "noModule" }
  | { code: "agentsLong"; path: string; size: number }
  | { code: "agentsMany"; paths: string[] }
  | { code: "decisionsTwice"; paths: string[] }
  | { code: "tooBig"; path: string; size: number }
  | { code: "noStatus"; count: number; paths: string[] };

/** AGENTS.md past this is too long (convention §1.2, « moins de ~15 Ko »). */
export const AGENTS_MAX_BYTES = 15_000;
/** A root instruction file this small is a « voir AGENTS.md » pointer, not a second text. */
const POINTER_BYTES = 500;
const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
/** How many offending paths a grouped line names before « … ». */
const SAMPLE = 3;

/**
 * The repo's gaps to the convention, from its tree and meta lines only — no file is read. A gap the
 * operator mapped away (a `doc-paths` block in `docs/README.md`) is not one: `c` is that mapping. Pure.
 */
export function docBilan(docs: readonly TreeDoc[], lines: readonly DocLine[], c: DocConvention): BilanIssue[] {
  const has = (r: Rubric) => docs.some((d) => rubricOf(d.path, [r]) !== null);
  const out: BilanIssue[] = [];
  for (const r of c.socle) if (r.required && !has(r)) out.push({ code: "missing", rubric: r.id, label: r.label });

  // The module is the one whose own rubrics (not shared with another module, like `architecture`) are most present.
  const ids = Object.values(c.modules).flatMap((rs) => rs.map((r) => r.id));
  const own = (rs: Rubric[]) => rs.filter((r) => ids.filter((id) => id === r.id).length === 1);
  const [best] = Object.values(c.modules)
    .map((rs) => ({ rs, score: own(rs).filter(has).length }))
    .filter((m) => m.score > 0)
    .sort((x, y) => y.score - x.score);
  if (Object.keys(c.modules).length > 0 && !best) out.push({ code: "noModule" });
  for (const r of best?.rs ?? []) if (r.required && !has(r)) out.push({ code: "missing", rubric: r.id, label: r.label });

  const size = new Map(docs.map((d) => [d.path, d.size]));
  for (const p of AGENT_FILES) if ((size.get(p) ?? 0) > AGENTS_MAX_BYTES) out.push({ code: "agentsLong", path: p, size: size.get(p)! });
  const texts = AGENT_FILES.filter((p) => (size.get(p) ?? 0) > POINTER_BYTES);
  if (texts.length > 1) out.push({ code: "agentsMany", paths: texts });

  // shortcut: a `decisions.md` beside the ADRs is flagged unless it lives in a module rubric (a GDD's
  // design journal, allowed by §1.4); whether a decision really sits in both needs reading them.
  const adr = c.socle.find((r) => r.id === "adr");
  const modules = Object.values(c.modules).flat();
  const journals = docs.filter((d) => /(^|\/)decisions\.md$/i.test(d.path) && rubricOf(d.path, modules) === null).map((d) => d.path);
  if (adr && has(adr) && journals.length > 0) out.push({ code: "decisionsTwice", paths: journals });

  // CHANGELOG.md is generated and grows by design (§1.7).
  for (const d of docs) if (d.size > c.maxFileBytes && d.path !== "CHANGELOG.md" && !AGENT_FILES.includes(d.path)) out.push({ code: "tooBig", path: d.path, size: d.size });

  // §1.3: every file under docs/ but an index (README.md) or a template opens with its status line.
  const meta = docMeta(lines);
  const bare = docs
    .map((d) => d.path)
    .filter((p) => p.startsWith("docs/") && !/(^|\/)(README|_template|0000-template)\.md$/i.test(p) && !meta.get(p)?.status)
    .sort();
  if (bare.length > 0) out.push({ code: "noStatus", count: bare.length, paths: bare.slice(0, SAMPLE) });
  return out;
}

/**
 * The repo's root when the board knows it (its card, herd, scan or hand-listed repos — hidden ones
 * included), else null: these routes read any known project, never an arbitrary path on disk.
 */
export async function knownRepoRoot(repo: string, known: readonly string[]): Promise<string | null> {
  const root = await repoRootOf(repo).catch(() => null);
  // `samePath`, not `includes`: on win32 git says `C:/x`, herdr `C:\x`, and the case may differ.
  return root && known.some((k) => samePath(k, root) || samePath(k, repo)) ? root : null;
}

export async function handleDocsRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (![DOCS_ROUTE, DOCS_FILE, DOCS_SEARCH, PAGES, PAGE].includes(pathname)) return null;
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("read");
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const repo = repoPathOf(q.get("repo"));
  if (!repo) return ctx.text("repo must be an absolute path", 400);
  const known = await listRepos(ctx.db, ctx.engine.current(), scanRootsFor(ctx.cfg.boardRepoRoots, homedir(), existsSync));
  const root = await knownRepoRoot(repo, known.map((r) => r.path));
  if (!root) return ctx.text("unknown repository: not one of the board's projects", 403);
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
  const [lines, convention] = await Promise.all([grepDocsOnRef(root, ref, META_PATTERN, "lines"), conventionFor(root, ref, docs)]);
  return ctx.json({
    ...buildIndex(ref, docs, lines, rubricsOf(convention) ?? [], ctx.db.getRoadmap(repo)),
    bilan: convention ? docBilan(docs, lines, convention) : [],
  });
}
