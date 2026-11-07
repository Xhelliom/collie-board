import type { LoaderFunctionArgs } from "react-router";

import { t } from "@/i18n";

import { apiRequest } from "./api";
import { loadRepoScope } from "./board";

// The Documents tab (bridge/docs.ts): the repo's Markdown on its default branch, classed by the
// documentation convention's rubrics. Read when the page opens and on a tap — never polled.

export interface DocEntry {
  path: string;
  title: string;
  size: number;
}

export type DocDecision =
  | { kind: "adr"; path: string; title: string; status: string | null; date: string | null }
  | { kind: "roadmap"; id: string; text: string; status: DecisionStatus; date: string | null };

export type DecisionStatus = "decided" | "leaning" | "open";

/** The filter class of a decision: a roadmap one says it; an ADR's free-text status is read — a proposal
 *  or draft leans, an open/undecided one is open, anything else (Accepted, Superseded…) was decided. Pure. */
export function decisionStatus(d: DocDecision): DecisionStatus {
  if (d.kind === "roadmap") return d.status;
  const s = d.status?.toLowerCase() ?? "";
  if (/propos|draft|brouillon|piste|lean/.test(s)) return "leaning";
  if (/open|ouvert|undecided/.test(s)) return "open";
  return "decided";
}

export interface DocsIndex {
  ref: string;
  rubrics: { id: string; label: string; docs: DocEntry[] }[];
  other: DocEntry[];
  decisions: DocDecision[];
  /** The gaps to the doc convention (bridge/docs.ts docBilan) — empty when it holds. */
  bilan?: BilanIssue[];
}

export type BilanIssue =
  | { code: "missing"; rubric: string; label: string }
  | { code: "noModule" }
  | { code: "agentsLong"; path: string; size: number }
  | { code: "agentsMany"; paths: string[] }
  | { code: "decisionsTwice"; paths: string[] }
  | { code: "tooBig"; path: string; size: number }
  | { code: "noStatus"; count: number; paths: string[] };

const kb = (size: number) => Math.round(size / 1000);

/** One gap, one line, in the operator's language. Pure. */
export function bilanLine(i: BilanIssue): string {
  switch (i.code) {
    case "missing":
      return t("docs.bilan.missing", { label: i.label });
    case "noModule":
      return t("docs.bilan.noModule");
    case "agentsLong":
      return t("docs.bilan.agentsLong", { path: i.path, kb: kb(i.size) });
    case "agentsMany":
      return t("docs.bilan.agentsMany", { paths: i.paths.join(", ") });
    case "decisionsTwice":
      return t("docs.bilan.decisionsTwice", { paths: i.paths.join(", ") });
    case "tooBig":
      return t("docs.bilan.tooBig", { path: i.path, kb: kb(i.size) });
    case "noStatus":
      return t("docs.bilan.noStatus", { count: i.count, paths: i.paths.join(", ") + (i.count > i.paths.length ? ", …" : "") });
  }
}

const q = (repo: string) => `repo=${encodeURIComponent(repo)}`;

export const fetchDocs = (repo: string, signal?: AbortSignal): Promise<DocsIndex> => apiRequest(`/api/docs?${q(repo)}`, { signal });

export const fetchDoc = (repo: string, path: string, signal?: AbortSignal): Promise<{ path: string; text: string; truncated: boolean }> =>
  apiRequest(`/api/docs/file?${q(repo)}&path=${encodeURIComponent(path)}`, { signal });

export const searchDocs = (repo: string, query: string, signal?: AbortSignal): Promise<{ paths: string[] }> =>
  apiRequest(`/api/docs/search?${q(repo)}&q=${encodeURIComponent(query)}`, { signal });

export async function docsLoader({ request }: LoaderFunctionArgs): Promise<{ repo: string | null; index: DocsIndex | null; pages: string[] }> {
  const repo = new URL(request.url).searchParams.get("repo") ?? loadRepoScope();
  if (!repo) return { repo, index: null, pages: [] };
  // The pages are a bonus in the tree: a failure to list them never hides the Markdown.
  const [index, pages] = await Promise.all([
    fetchDocs(repo, request.signal),
    fetchPages(repo, request.signal).then((r) => r.pages.map((p) => p.name), () => [] as string[]),
  ]);
  return { repo, index, pages };
}

/** A folder of the Documents tree — the repo's real folders, as the file paths spell them. */
export interface DocFolder {
  name: string;
  path: string;
  folders: DocFolder[];
  files: DocEntry[];
}

/** The folder tree of `files`, folders first then files, each by name — the explorer's order. Pure. */
export function docTree(files: readonly DocEntry[]): DocFolder {
  const root: DocFolder = { name: "", path: "", folders: [], files: [] };
  for (const f of files) {
    let at = root;
    for (const seg of f.path.split("/").slice(0, -1)) {
      let next = at.folders.find((x) => x.name === seg);
      if (!next) at.folders.push((next = { name: seg, path: at.path ? `${at.path}/${seg}` : seg, folders: [], files: [] }));
      at = next;
    }
    at.files.push(f);
  }
  const sort = (d: DocFolder) => {
    d.folders.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.path.localeCompare(b.path));
    d.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** Every file under a folder, its subfolders included. Pure. */
export const fileCount = (d: DocFolder): number => d.folders.reduce((n, c) => n + fileCount(c), d.files.length);

/** The folders that hold `path`: `docs/plan/a.md` → `docs`, `docs/plan`. Pure. */
export const folderChain = (path: string): string[] =>
  path.split("/").slice(0, -1).map((_, i, segs) => segs.slice(0, i + 1).join("/"));

/** A custom page's place in the tree, and back: `roadmap` ⇄ `docs/pages/roadmap.html`. */
export const pagePath = (name: string): string => `docs/pages/${name}.html`;
export const pageNameOf = (path: string): string | null => /^docs\/pages\/([^/]+)\.html$/.exec(path)?.[1] ?? null;

/**
 * The repo path a relative link of `from` points at, its `#anchor` dropped — or null when it climbs
 * out of the repo. `docs/plan/a.md` + `../adr/b.md` → `docs/adr/b.md`. Pure.
 */
export function resolveDocLink(from: string, href: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const seg of href.split("#")[0]!.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg !== "..") parts.push(seg);
    else if (parts.pop() === undefined) return null;
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** A doc kept by the search: its title or path holds the query, or the bridge found it in the text. Pure. */
export const docMatches = (d: DocEntry, query: string, inText: ReadonlySet<string>): boolean => {
  const needle = query.trim().toLowerCase();
  return !needle || d.title.toLowerCase().includes(needle) || d.path.toLowerCase().includes(needle) || inText.has(d.path);
};

/** The project's custom pages — `docs/pages/<name>.html` on its default branch (bridge/docs.ts). */
export const fetchPages = (repo: string, signal?: AbortSignal): Promise<{ ref: string; pages: { name: string; size: number }[] }> =>
  apiRequest(`/api/docs/pages?${q(repo)}`, { signal });

/** The iframe's src: served scrubbed under its own sandbox CSP, never the board's. */
export const pageUrl = (repo: string, name: string): string => `/api/docs/page?${q(repo)}&name=${encodeURIComponent(name)}`;
