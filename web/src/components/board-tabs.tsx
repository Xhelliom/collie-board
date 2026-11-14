import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { BookOpen, ChevronDown, FileCode, ClipboardCheck, Columns3, GitPullRequest, Map as MapIcon, Milestone, MoreHorizontal, Settings } from "lucide-react";

import { useT, type MessageKey } from "@/i18n";
import { AddProjectSheet } from "@/components/add-project-sheet";
import { loadRepoScope, repoName, saveRepoScope, withListedRepos } from "@/lib/board";
import { fetchPageTabs, PAGE_TABS_EVENT, pageTab } from "@/lib/docs";
import { setRepoListed, useListedRepos } from "@/lib/listed-repos";
import { cn } from "@/lib/utils";

// The seven views of one repo's work, in priority order: as many as the width holds are shown, the rest
// sit behind « More », which exists only when it hides something (priority+). The repo itself is picked
// from the header's title (`RepoTitle`), not from this row. `replace`: switching views or repos must not
// stack history, or Back would walk through them instead of leaving.

const TABS = [
  { key: "project", label: "tabs.project", path: "/board/project", icon: MapIcon },
  { key: "board", label: "tabs.board", path: "/board", icon: Columns3 },
  { key: "recette", label: "tabs.recette", path: "/board/recette", icon: ClipboardCheck },
  { key: "roadmap", label: "tabs.roadmap", path: "/board/roadmap", icon: Milestone },
  { key: "prs", label: "tabs.prs", path: "/board/prs", icon: GitPullRequest },
  { key: "documents", label: "tabs.documents", path: "/board/documents", icon: BookOpen },
  { key: "settings", label: "tabs.settings", path: "/board/settings", icon: Settings },
] as const satisfies readonly { key: string; label: MessageKey; path: string; icon: unknown }[];

/** Which of the seven the location is on. Pure, exported for the test. */
export function boardTabFor(pathname: string): (typeof TABS)[number]["key"] | null {
  return TABS.find((tab) => tab.path === pathname)?.key ?? null;
}

/** Which tabs to show, by index, given each one's width, the room, the « More » button's width and the
 *  current tab: all when they fit; otherwise the first ones that fit beside « More », and the current
 *  one always — in the last visible place when it would have been hidden. Pure, exported for the test. */
export function visibleTabs(widths: number[], room: number, more: number, active: number): number[] {
  const all = widths.map((_, i) => i);
  if (widths.reduce((a, b) => a + b, 0) <= room) return all;
  let used = more + (active >= 0 ? widths[active]! : 0);
  const out: number[] = [];
  for (const i of all) {
    if (i === active) continue;
    if (used + widths[i]! > room) break;
    out.push(i);
    used += widths[i]!;
  }
  // The current one keeps its rank when it fell among the shown; past them it lands last by the same sort.
  if (active >= 0) out.push(active);
  return out.sort((a, b) => a - b);
}

export interface RepoOption {
  path: string;
  name: string;
}

interface TabItem {
  key: string;
  to: string;
  label: string;
  icon: typeof Settings;
  current: boolean;
  count?: number;
}

const tabCls = "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold";

/** `counts`: a figure beside a tab's name (the project page gives the acceptance list's), when the view knows it. */
export function BoardTabs({ counts = {} }: { counts?: Partial<Record<(typeof TABS)[number]["key"], number>> } = {}) {
  const t = useT();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = boardTabFor(pathname);
  const repo = params.get("repo") ?? loadRepoScope();
  const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  // The pages the operator ticked « En onglet » in Documents — read when the row mounts and when a tick
  // changes them, never polled. Nothing is a tab until it is ticked.
  const [tabs, setTabs] = useState<string[]>([]);
  useEffect(() => {
    setTabs([]);
    if (!repo) return;
    const ctl = new AbortController();
    const read = () =>
      fetchPageTabs(repo, ctl.signal)
        .then((r) => setTabs(r.tabs))
        .catch(() => {});
    void read();
    window.addEventListener(PAGE_TABS_EVENT, read);
    return () => {
      ctl.abort();
      window.removeEventListener(PAGE_TABS_EVENT, read);
    };
  }, [repo]);
  const pageOpen = pathname === "/board/page" ? `${params.get("card") ? `${params.get("card")}/` : ""}${params.get("name") ?? ""}` : null;

  const items: TabItem[] = [
    ...TABS.map((tab) => ({ key: tab.key, to: `${tab.path}${q}`, label: t(tab.label), icon: tab.icon, current: active === tab.key, count: counts[tab.key] || undefined })),
    ...(repo ? tabs : []).map((key) => ({ key: `page:${key}`, to: pageTab(repo!, key).to, label: pageTab(repo!, key).label, icon: FileCode, current: pageOpen === key })),
  ];
  const activeIndex = items.findIndex((i) => i.current);

  // Measured on an invisible copy of the whole row, on every resize — no poll. Until measured (and in a
  // test, where nothing has a width) every tab shows.
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number[] | null>(null);
  const sig = items.map((i) => i.label).join("\n");
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const widths = [...measure.children].map((c) => (c as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0;
      setShown(visibleTabs(widths, row.clientWidth, more, activeIndex));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    // The ruler too: its tabs widen when the web font lands, the row does not.
    ro.observe(measure);
    return () => ro.disconnect();
  }, [sig, activeIndex]);
  const visible = shown ?? items.map((_, i) => i);
  const rest = items.filter((_, i) => !visible.includes(i));

  return (
    <nav aria-label={t("tabs.aria")} className="relative border-b border-border bg-background px-1 lg:px-2">
      <div ref={rowRef} className="flex min-w-0 items-stretch">
        {visible.map((i) => {
          const tab = items[i]!;
          return (
            <Link
              key={tab.key}
              to={tab.to}
              replace
              aria-current={tab.current ? "page" : undefined}
              className={cn(
                tabCls,
                "-mb-px border-b-2 transition-colors",
                tab.current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="size-4" aria-hidden="true" />
              {tab.label}
              {tab.count && <span className="font-medium text-status-blocked">{tab.count}</span>}
            </Link>
          );
        })}
        {rest.length > 0 && <MoreMenu items={rest} label={t("tabs.more")} />}
      </div>
      {/* The ruler: every tab and « More », as wide as they draw, never seen. */}
      <div ref={measureRef} aria-hidden="true" inert className="invisible absolute left-0 top-0 flex h-0 w-max overflow-hidden">
        {items.map((tab) => (
          <span key={tab.key} className={tabCls}>
            <tab.icon className="size-4" />
            {tab.label}
            {tab.count && <span>{tab.count}</span>}
          </span>
        ))}
        <span className={tabCls}>
          <MoreHorizontal className="size-4" />
          {t("tabs.more")}
          <ChevronDown className="size-3.5" />
        </span>
      </div>
    </nav>
  );
}

function MoreMenu({ items, label }: { items: TabItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative ml-auto flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={cn(tabCls, "-mb-px border-b-2 border-transparent text-muted-foreground hover:text-foreground")}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
        {label}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 flex min-w-48 flex-col rounded-xl border bg-popover p-1 text-popover-foreground shadow-(--shadow-3)">
          {items.map((tab) => (
            <Link
              key={tab.key}
              role="menuitem"
              to={tab.to}
              replace
              onClick={() => setOpen(false)}
              className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium hover:bg-muted/60"
            >
              <tab.icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {tab.label}
              {tab.count && <span className="ml-auto text-status-blocked">{tab.count}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Never a repo: a repo is an absolute path.
const ADD = "+add";
const UNLIST = "+unlist";

/** The header's title on every repo view: the project's name IS the repo picker — touch it to change
 *  project, to see all of them, to add one or take a hand-added one off the list. `subtitle` is the
 *  view's own second line. */
export function RepoTitle({ repos = [], subtitle }: { repos?: RepoOption[]; subtitle?: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const repo = params.get("repo") ?? loadRepoScope();
  const [adding, setAdding] = useState(false);
  const listed = useListedRepos();
  // The repos with cards, then the ones the operator added by hand — never every repo the bridge knows.
  const all = withListedRepos(repos, listed);
  // The scope stays selectable even when nothing in the current list uses it any more.
  const options = repo && !all.some((r) => r.path === repo) ? [{ path: repo, name: repoName(repo) }, ...all] : all;

  function pick(next: string) {
    if (next === ADD) return setAdding(true);
    // Takes the repo off the hand-made list only: its cards, if any, keep it listed through them.
    if (next === UNLIST) return void (repo && setRepoListed(repo, false).catch(() => {}));
    const value = next || null;
    saveRepoScope(value);
    void navigate(`${pathname}${value ? `?repo=${encodeURIComponent(value)}` : ""}`, { replace: true });
  }

  return (
    <div className="min-w-0">
      <label className="relative flex min-w-0 items-center gap-1 rounded-md hover:text-foreground/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{repo ? repoName(repo) : t("repo.all")}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {/* The native picker over the title: the phone's own wheel, nothing to hand-roll. */}
        <select
          aria-label={t("repo.label")}
          value={repo ?? ""}
          onChange={(e) => pick(e.target.value)}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0"
        >
          <option value="">{t("repo.all")}</option>
          {options.map((r) => (
            <option key={r.path} value={r.path}>
              {r.name}
            </option>
          ))}
          <option value={ADD}>{t("project.add")}…</option>
          {repo && listed.includes(repo) && <option value={UNLIST}>{t("project.unlist")}</option>}
        </select>
      </label>
      {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
      <AddProjectSheet open={adding} onClose={() => setAdding(false)} exclude={all.map((r) => r.path)} />
    </div>
  );
}
