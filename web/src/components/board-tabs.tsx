import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ChevronDown, Columns3, GitPullRequest, Map as MapIcon, Plus, Settings, X } from "lucide-react";

import { useT, type MessageKey } from "@/i18n";
import { AddProjectSheet } from "@/components/add-project-sheet";
import { loadRepoScope, saveRepoScope, withListedRepos } from "@/lib/board";
import { setRepoListed, useListedRepos } from "@/lib/listed-repos";
import { cn } from "@/lib/utils";

// Board, Project, Open PRs and Settings are four views of the same thing — one repo's work — so they are
// siblings under the Board tab, not a board with two hidden side doors. One row, on all four, that
// carries the repo scope across AND lets you change it: a project view you cannot leave for another
// repo is a dead end. `replace`: switching views or repos must not stack history, or Back would walk
// through them instead of leaving.

const TABS = [
  { key: "board", label: "tabs.board", path: "/board", icon: Columns3 },
  { key: "project", label: "tabs.project", path: "/board/project", icon: MapIcon },
  { key: "prs", label: "tabs.prs", path: "/board/prs", icon: GitPullRequest },
  { key: "settings", label: "tabs.settings", path: "/board/settings", icon: Settings },
] as const satisfies readonly { key: string; label: MessageKey; path: string; icon: unknown }[];

/** Which of the four the location is on. Pure, exported for the test. */
export function boardTabFor(pathname: string): (typeof TABS)[number]["key"] | null {
  if (pathname === "/board") return "board";
  if (pathname === "/board/project") return "project";
  if (pathname === "/board/prs") return "prs";
  if (pathname === "/board/settings") return "settings";
  return null;
}

export interface RepoOption {
  path: string;
  name: string;
}

export function BoardTabs({ repos = [] }: { repos?: RepoOption[] }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = boardTabFor(pathname);
  const repo = params.get("repo") ?? loadRepoScope();
  const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  const [adding, setAdding] = useState(false);
  const listed = useListedRepos();
  // The repos with cards, then the ones the operator added by hand — never every repo the bridge knows.
  const all = withListedRepos(repos, listed);
  // The scope stays selectable even when nothing in the current list uses it any more.
  const options = repo && !all.some((r) => r.path === repo) ? [{ path: repo, name: repo.split("/").pop() || repo }, ...all] : all;

  function pick(next: string) {
    const value = next || null;
    saveRepoScope(value);
    void navigate(`${pathname}${value ? `?repo=${encodeURIComponent(value)}` : ""}`, { replace: true });
  }

  return (
    <nav aria-label={t("tabs.aria")} className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-2 lg:px-5">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          to={`${tab.path}${q}`}
          replace
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
            active === tab.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <tab.icon className="size-4" />
          {t(tab.label)}
        </Link>
      ))}
      {/* The repo picker and its + / unlist share ONE row, also on a phone: the header is three lines
          tall otherwise, on a screen that is mostly list. */}
      <div className="order-last flex w-full items-center gap-1 sm:order-none sm:ml-auto sm:w-auto">
      {options.length > 0 && (
        <label className="relative min-w-0 flex-1 sm:flex-none">
          <span className="sr-only">{t("repo.label")}</span>
          <select
            value={repo ?? ""}
            onChange={(e) => pick(e.target.value)}
            className="h-9 w-full appearance-none truncate rounded-lg border border-border bg-background py-0 pl-3 pr-8 text-sm font-semibold sm:w-auto sm:max-w-[16rem]"
          >
            <option value="">{t("repo.all")}</option>
            {options.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </label>
      )}
      <div className="flex gap-1">
        {repo && listed.includes(repo) && (
          // Takes the repo off the hand-made list only: its cards, if any, keep it listed through them.
          <button
            type="button"
            onClick={() => void setRepoListed(repo, false).catch(() => {})}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted/60"
          >
            <X className="size-4" />
            {t("project.unlist")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t("project.add")}
          title={t("project.add")}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60"
        >
          <Plus className="size-4" />
        </button>
      </div>
      </div>
      <AddProjectSheet open={adding} onClose={() => setAdding(false)} exclude={all.map((r) => r.path)} />
    </nav>
  );
}
