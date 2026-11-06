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

export async function docsLoader({ request }: LoaderFunctionArgs): Promise<{ repo: string | null; index: DocsIndex | null }> {
  const repo = new URL(request.url).searchParams.get("repo") ?? loadRepoScope();
  return { repo, index: repo ? await fetchDocs(repo, request.signal) : null };
}

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
