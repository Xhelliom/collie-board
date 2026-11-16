import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { BookOpen, Check, ChevronDown, FileCode, ClipboardCheck, Columns3, GitPullRequest, Map as MapIcon, Milestone, MoreHorizontal, Settings } from "lucide-react";

import { useT, type MessageKey } from "@/i18n";
import { AddProjectSheet } from "@/components/add-project-sheet";
import { BottomSheet } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-media-query";
import { loadRepoScope, repoName, saveRepoScope, withListedRepos } from "@/lib/board";
import { pageTab, usePageTabs } from "@/lib/docs";
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
  // The pages the operator ticked « En onglet » in Documents. Nothing is a tab until it is ticked.
  const tabs = usePageTabs(repo)?.tabs ?? [];
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

/** Case- and accent-insensitive search key: « Écran » matches « ecr ». Pure, exported for the test. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

interface PickItem {
  value: string;
  label: string;
  /** An action, not a project: never filtered out, so « Add a project » stays at hand when nothing matches. */
  action?: boolean;
}

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
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listed = useListedRepos();
  // The repos with cards, then the ones the operator added by hand — never every repo the bridge knows.
  const all = withListedRepos(repos, listed);
  // The scope stays selectable even when nothing in the current list uses it any more.
  const options = repo && !all.some((r) => r.path === repo) ? [{ path: repo, name: repoName(repo) }, ...all] : all;
  const items: PickItem[] = [
    { value: "", label: t("repo.all") },
    ...options.map((r) => ({ value: r.path, label: r.name })),
    { value: ADD, label: `${t("project.add")}…`, action: true },
    ...(repo && listed.includes(repo) ? [{ value: UNLIST, label: t("project.unlist"), action: true }] : []),
  ];
  const name = repo ? repoName(repo) : t("repo.all");

  // The anchored panel closes on a press outside it; the sheet has its own overlay for that.
  useEffect(() => {
    if (!open || !desktop) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, desktop]);

  function pick(next: string) {
    setOpen(false);
    if (next === ADD) return setAdding(true);
    // Takes the repo off the hand-made list only: its cards, if any, keep it listed through them.
    if (next === UNLIST) return void (repo && setRepoListed(repo, false).catch(() => {}));
    const value = next || null;
    saveRepoScope(value);
    void navigate(`${pathname}${value ? `?repo=${encodeURIComponent(value)}` : ""}`, { replace: true });
  }

  const picker = open && <RepoPicker items={items} current={repo ?? ""} onPick={pick} onClose={() => setOpen(false)} inputRef={inputRef} />;

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("repo.label")}, ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{name}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && desktop && "rotate-180")} aria-hidden="true" />
      </button>
      {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
      {desktop ? (
        picker && (
          <div className="absolute left-0 top-full z-30 mt-1 flex max-h-[min(28rem,70vh)] w-80 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-(--shadow-3)">
            {picker}
          </div>
        )
      ) : (
        // Full screen on a phone: the keyboard takes half of it, the list needs the rest.
        <BottomSheet open={open} onClose={() => setOpen(false)} title={t("repo.label")} initialFocus={inputRef} className="h-dvh max-h-dvh rounded-none pt-[env(safe-area-inset-top)]">
          {picker}
        </BottomSheet>
      )}
      <AddProjectSheet open={adding} onClose={() => setAdding(false)} exclude={all.map((r) => r.path)} />
    </div>
  );
}

/** The search field and the list it filters — ARIA combobox: focus stays in the field, the arrows move
 *  `aria-activedescendant`, Enter picks, Escape closes. */
function RepoPicker({
  items,
  current,
  onPick,
  onClose,
  inputRef,
}: {
  items: PickItem[];
  current: string;
  onPick: (value: string) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const shown = items.filter((i) => i.action || fold(i.label).includes(q));
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.value === current)));
  const at = Math.min(active, shown.length - 1);
  const optId = (i: number) => `${id}-o${i}`;
  const empty = !shown.some((i) => !i.action);

  useEffect(() => {
    document.getElementById(optId(at))?.scrollIntoView?.({ block: "nearest" });
  });

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[at]) onPick(shown[at].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-inherit p-2">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optId(at) : undefined}
          aria-label={t("repo.search")}
          placeholder={t("repo.search")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring lg:text-sm"
        />
      </div>
      {empty && <p className="px-4 pt-1 text-sm text-muted-foreground">{t("repo.none")}</p>}
      <ul id={`${id}-list`} role="listbox" aria-label={t("repo.label")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {shown.map((item, i) => (
          <li
            key={item.value}
            id={optId(i)}
            role="option"
            aria-selected={i === at}
            // Keep focus in the field: the list is driven from it.
            onMouseDown={(e) => e.preventDefault()}
            onPointerMove={() => i !== at && setActive(i)}
            onClick={() => onPick(item.value)}
            className={cn(
              "flex h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm lg:h-10",
              i === at && "bg-muted",
              item.action ? "text-muted-foreground" : "font-medium",
              item.action && (i === 0 || !shown[i - 1]!.action) && "mt-1",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {!item.action && item.value === current && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </>
  );
}
