import { Link, useLocation, useSearchParams } from "react-router";
import { Columns3, GitPullRequest, Map as MapIcon } from "lucide-react";

import { loadRepoScope } from "@/lib/board";
import { cn } from "@/lib/utils";

// Board, Project and Open PRs are three views of the same thing — one repo's work — so they are
// siblings under the Board tab, not a board with two hidden side doors. One row, on all three, that
// carries the repo scope across. `replace`: switching views must not stack history, or Back would
// walk through the views instead of leaving them.

const TABS = [
  { key: "board", label: "Board", path: "/board", icon: Columns3 },
  { key: "project", label: "Project", path: "/board/project", icon: MapIcon },
  { key: "prs", label: "Open PRs", path: "/board/prs", icon: GitPullRequest },
] as const;

/** Which of the three the location is on. Pure, exported for the test. */
export function boardTabFor(pathname: string): (typeof TABS)[number]["key"] | null {
  if (pathname === "/board") return "board";
  if (pathname === "/board/project") return "project";
  if (pathname === "/board/prs") return "prs";
  return null;
}

export function BoardTabs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = boardTabFor(pathname);
  const repo = params.get("repo") ?? loadRepoScope();
  const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  return (
    <nav aria-label="Board views" className="flex gap-1 border-b border-border bg-background px-3 py-2 lg:px-5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          to={`${t.path}${q}`}
          replace
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
            active === t.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <t.icon className="size-4" />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
