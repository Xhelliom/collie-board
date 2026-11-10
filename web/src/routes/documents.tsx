import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ChevronRight, FilePlus2, FileText, Folder, FolderOpen, Globe, ListChecks, PencilLine, Search, Wand2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs } from "@/components/board-tabs";
import { DocLinkContext, MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { useT } from "@/i18n";
import { createCard, repoName } from "@/lib/board";
import { setStatus } from "@/lib/status";
import {
  bilanLine,
  decisionStatus,
  docMatches,
  docTree,
  fetchDoc,
  fileCount,
  folderChain,
  pageNameOf,
  isPageName,
  pagePath,
  resolveDocLink,
  searchDocs,
  type DecisionStatus,
  type DocDecision,
  type DocEntry,
  type DocFolder,
  type DocsIndex,
} from "@/lib/docs";
import { cn } from "@/lib/utils";

import { PageFrame } from "./custom-page";

// The Documents tab: the repo's real folders as an explorer tree — its Markdown on the default branch,
// its custom pages (docs/pages/*.html) and a virtual folder for the roadmap decisions. `?doc=<path>`
// reads one beside the tree on a wide screen, in its place on a phone: Markdown through the
// transcript's renderer (text nodes only), a page in the tab's sandboxed frame (ADR 0053).

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const ROW = cn("flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm hover:bg-muted/60", FOCUS);
/** Text search waits for the typing to settle — a request per keystroke would be a poll by another name. */
const SEARCH_DELAY_MS = 300;
const STATUSES: readonly DecisionStatus[] = ["decided", "leaning", "open"];
/** The virtual folder's key among the opened ones — no real path starts with `@`. */
const ROADMAP = "@roadmap";
const indent = (depth: number) => ({ paddingLeft: `${0.25 + depth * 1}rem` });

// The folders the operator left open, per project: a convenience, so a storage that throws just forgets.
const openKey = (repo: string) => `collie:docs-open:${repo}`;
function loadOpen(repo: string): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(openKey(repo)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function saveOpen(repo: string, open: ReadonlySet<string>) {
  try {
    localStorage.setItem(openKey(repo), JSON.stringify([...open]));
  } catch {
    /* private window or full storage: the tree just won't remember */
  }
}

export function DocumentsRoute() {
  const t = useT();
  const { repo, index, pages } = useLoaderData() as { repo: string | null; index: DocsIndex | null; pages: string[] };
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const doc = params.get("doc");
  const at = (path: string | null) => `/board/documents?repo=${encodeURIComponent(repo ?? "")}${path ? `&doc=${encodeURIComponent(path)}` : ""}`;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title={t("docs.title")} subtitle={index ? t("docs.onRef", { ref: index.ref }) : undefined} />
      <BoardTabs repos={repo ? [{ path: repo, name: repoName(repo) }] : []} />
      <h1 className="sr-only">{t("docs.title")}</h1>
      {!repo || !index ? (
        <main className="flex-1 p-3">
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.pickRepo")}</p>
        </main>
      ) : (
        // Two columns that scroll on their own on a wide screen; on a phone one at a time — the tree,
        // or the document opened from it.
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <div className={cn("flex-col p-3 pb-24 lg:flex lg:overflow-y-auto lg:border-r lg:border-border lg:p-5", doc ? "hidden" : "flex")}>
            <DocTree key={repo} repo={repo} index={index} pages={pages} doc={doc} hrefOf={at} />
          </div>
          <div className={cn("min-w-0 flex-col p-3 pb-24 lg:flex lg:overflow-y-auto lg:p-5", doc ? "flex" : "hidden")}>
            {doc ? (
              <DocView repo={repo} gitRef={index.ref} path={doc} backTo={at(null)} open={(p) => void navigate(at(p))} />
            ) : (
              <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.pickFile")}</p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

function DocTree({ repo, index, pages, doc, hrefOf }: { repo: string; index: DocsIndex; pages: string[]; doc: string | null; hrefOf: (path: string) => string }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [inText, setInText] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => loadOpen(repo));
  // The doc check starts folded when it has gaps: a long list on top would push the tree off the screen.
  const [bilanOpen, setBilanOpen] = useState(!index.bilan?.length);
  const [statuses, setStatuses] = useState<ReadonlySet<DecisionStatus>>(new Set());

  useEffect(() => {
    const needle = query.trim();
    if (!needle) return setInText(new Set());
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      searchDocs(repo, needle, ctl.signal)
        .then((r) => setInText(new Set(r.paths)))
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [repo, query]);

  // The document read shows where it lives: its folders open, as an explorer would.
  useEffect(() => {
    if (doc) setOpened((o) => (folderChain(doc).every((f) => o.has(f)) ? o : new Set([...o, ...folderChain(doc)])));
  }, [doc]);
  useEffect(() => saveOpen(repo, opened), [repo, opened]);

  const needle = query.trim().toLowerCase();
  const files = new Map<string, DocEntry>();
  for (const d of [...index.rubrics.flatMap((r) => r.docs), ...index.other]) files.set(d.path, d);
  for (const name of pages) files.set(pagePath(name), { path: pagePath(name), title: name, size: 0 });
  const tree = docTree([...files.values()].filter((d) => docMatches(d, query, inText)));
  const roadmapAll = index.decisions.filter((d): d is Extract<DocDecision, { kind: "roadmap" }> => d.kind === "roadmap");
  const roadmap = roadmapAll.filter((d) => (statuses.size === 0 || statuses.has(decisionStatus(d))) && (!needle || d.text.toLowerCase().includes(needle)));
  const showRoadmap = roadmapAll.length > 0 && (!needle || roadmap.length > 0);
  // A search opens every folder that kept a hit, without touching what the operator left open.
  const isOpen = (key: string) => !!needle || opened.has(key);
  const toggle = (key: string) =>
    setOpened((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const flip = (s: DecisionStatus) =>
    setStatuses((c) => {
      const next = new Set(c);
      if (!next.delete(s)) next.add(s);
      return next;
    });

  return (
    <div className="flex w-full flex-col gap-3">
      <label className="relative">
        <span className="sr-only">{t("docs.search")}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("docs.search")}
          className={cn("h-10 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm", FOCUS)}
        />
      </label>

      <NewPage repo={repo} />

      {!needle && index.bilan && (
        <section className="flex flex-col gap-1">
          <button type="button" aria-expanded={bilanOpen} onClick={() => setBilanOpen(!bilanOpen)} className={cn("flex items-center gap-1.5 rounded-lg px-1 py-1 text-left hover:bg-muted/60", FOCUS)}>
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/70 transition-transform", bilanOpen && "rotate-90")} />
            <SectionLabel>{t("docs.bilan.title")}</SectionLabel>
            <span className="text-xs tabular-nums text-muted-foreground/70">{index.bilan.length}</span>
          </button>
          {bilanOpen && <DocBilan repo={repo} gitRef={index.ref} issues={index.bilan} />}
        </section>
      )}

      {files.size === 0 && roadmapAll.length === 0 ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.empty", { ref: index.ref })}</p>
      ) : tree.folders.length === 0 && tree.files.length === 0 && !showRoadmap ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.noMatch")}</p>
      ) : (
        <nav aria-label={t("docs.tree")} className="flex flex-col">
          {showRoadmap && (
            <>
              <FolderRow label={t("docs.roadmapFolder", { count: roadmap.length })} icon={<ListChecks className="size-4 shrink-0 text-primary" />} open={isOpen(ROADMAP)} depth={0} onToggle={() => toggle(ROADMAP)} />
              {isOpen(ROADMAP) && (
                <div className="flex flex-col" style={indent(1)}>
                  <div role="group" aria-label={t("docs.statusFilter")} className="flex flex-wrap gap-1.5 px-1 py-1">
                    {STATUSES.map((s) => (
                      <Chip key={s} label={t(`docs.status.${s}`)} active={statuses.has(s)} onClick={() => flip(s)} />
                    ))}
                  </div>
                  {roadmap.map((d) => (
                    <DecisionRow key={d.id} decision={d} />
                  ))}
                </div>
              )}
            </>
          )}
          <FolderItems folder={tree} depth={0} isOpen={isOpen} toggle={toggle} doc={doc} hrefOf={hrefOf} />
        </nav>
      )}
    </div>
  );
}

function FolderItems({ folder, depth, isOpen, toggle, doc, hrefOf }: { folder: DocFolder; depth: number; isOpen: (key: string) => boolean; toggle: (key: string) => void; doc: string | null; hrefOf: (path: string) => string }) {
  return (
    <>
      {folder.folders.map((f) => (
        <Fragment key={f.path}>
          <FolderRow label={f.name} count={fileCount(f)} open={isOpen(f.path)} depth={depth} onToggle={() => toggle(f.path)} />
          {isOpen(f.path) && <FolderItems folder={f} depth={depth + 1} isOpen={isOpen} toggle={toggle} doc={doc} hrefOf={hrefOf} />}
        </Fragment>
      ))}
      {folder.files.map((d) => {
        const name = d.path.slice(d.path.lastIndexOf("/") + 1);
        const page = pageNameOf(d.path) !== null;
        const Icon = page ? Globe : FileText;
        return (
          <Link key={d.path} to={hrefOf(d.path)} aria-current={d.path === doc ? "page" : undefined} className={cn(ROW, d.path === doc && "bg-muted font-semibold")} style={indent(depth + 1)} title={d.title}>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{name}</span>
            {!page && d.title !== name && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{d.title}</span>}
          </Link>
        );
      })}
    </>
  );
}

function FolderRow({ label, count, icon, open, depth, onToggle }: { label: string; count?: number; icon?: ReactNode; open: boolean; depth: number; onToggle: () => void }) {
  const FolderIcon = open ? FolderOpen : Folder;
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className={ROW} style={indent(depth)}>
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-90")} />
      {icon ?? <FolderIcon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 truncate font-medium">{label}</span>
      {/* The count is for a folded folder: an open one shows its files. */}
      {!open && count !== undefined && <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>}
    </button>
  );
}

/**
 * The gaps to the doc convention, one line each, and « Mettre la doc aux normes »: a card whose agent
 * asks the operator first (an open decision on the card), then proposes a mapping by PR. The board
 * neither moves nor deletes anything itself.
 */
function DocBilan({ repo, gitRef, issues }: { repo: string; gitRef: string; issues: NonNullable<DocsIndex["bilan"]> }) {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const fix = async () => {
    setBusy(true);
    try {
      const { card } = await createCard({
        title: t("docs.fix.cardTitle", { repo: repoName(repo) }),
        spec: t("docs.fix.cardSpec", { ref: gitRef, gaps: issues.map((i) => `- ${bilanLine(i)}`).join("\n") }),
        repoPath: repo,
      });
      setStatus(t("docs.fix.created"), "success");
      void navigate(`/card/${encodeURIComponent(card.id)}`);
    } catch (e) {
      setStatus(t("docs.ask.failed", { why: e instanceof Error ? e.message : String(e) }), "error");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("docs.bilan.ok")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {issues.map((i, n) => (
              <li key={n} className="break-words">
                {bilanLine(i)}
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void fix()}>
            <Wand2 />
            {t("docs.fix.open")}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * « Nouvelle page » : a name and a brief become a card whose deliverable is `docs/pages/<name>.html`,
 * its spec carrying the inert-page contract (ADR 0053). The agent builds it, the PR ships it, and the
 * tree lists it once it is on the default branch — the board writes nothing itself.
 */
function NewPage({ repo }: { repo: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = name.trim();
  const valid = isPageName(slug);

  const submit = async () => {
    if (!valid || !brief.trim() || busy) return;
    setBusy(true);
    try {
      const path = pagePath(slug);
      const { card } = await createCard({
        title: t("docs.newPage.cardTitle", { name: slug }),
        spec: `${t("docs.newPage.cardFile", { path })}\n\n${brief.trim()}\n\n${t("docs.newPage.cardContract", { path })}`,
        repoPath: repo,
        // A page is a document: no gate, no CI, a proofreading for its recette.
        category: "business",
      });
      setStatus(t("docs.ask.created"), "success");
      void navigate(`/card/${encodeURIComponent(card.id)}`);
    } catch (e) {
      setStatus(t("docs.ask.failed", { why: e instanceof Error ? e.message : String(e) }), "error");
      setBusy(false);
    }
  };

  if (!open)
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <FilePlus2 />
        {t("docs.newPage.open")}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("docs.newPage.name")}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("docs.newPage.namePlaceholder")}
          aria-invalid={slug !== "" && !valid}
          className={cn("h-10 w-full rounded-lg border border-border bg-background px-2 font-mono text-sm font-normal", FOCUS)}
        />
      </label>
      <span className={cn("-mt-1 text-xs", slug && !valid ? "text-destructive" : "text-muted-foreground")}>
        {slug && !valid ? t("docs.newPage.badName") : t("docs.newPage.path", { path: pagePath(slug || "…") })}
      </span>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("docs.newPage.brief")}
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder={t("docs.newPage.briefPlaceholder")}
          className={cn("w-full rounded-lg border border-border bg-background p-2 text-sm font-normal", FOCUS)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("docs.ask.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!valid || !brief.trim() || busy}>
          {t("docs.ask.submit")}
        </Button>
      </div>
    </form>
  );
}

function DecisionRow({ decision: d }: { decision: Extract<DocDecision, { kind: "roadmap" }> }) {
  const t = useT();
  return (
    <div className="flex w-full flex-col px-2.5 py-1.5 text-sm">
      <span className="font-medium">{d.text}</span>
      <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{t(`docs.status.${d.status}`)}</span>
        {d.date && <span>{d.date}</span>}
      </span>
    </div>
  );
}

type Loaded = { state: "loading" } | { state: "error" } | { state: "ok"; text: string; truncated: boolean };

function DocView({ repo, gitRef, path, backTo, open }: { repo: string; gitRef: string; path: string; backTo: string; open: (path: string) => void }) {
  const t = useT();
  const page = pageNameOf(path);
  return (
    <article className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        {/* On a wide screen the tree stays beside the document: nothing to go back to. */}
        <Link to={backTo} aria-label={t("docs.back")} className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted/60 lg:hidden", FOCUS)}>
          <ArrowLeft className="size-4" />
        </Link>
        <nav aria-label={t("docs.breadcrumb")} className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {path.split("/").join(" › ")}
        </nav>
      </div>
      <AskEdit repo={repo} gitRef={gitRef} path={path} />
      {page ? <PageFrame key={page} repo={repo} name={page} /> : <MarkdownDoc repo={repo} gitRef={gitRef} path={path} open={open} />}
    </article>
  );
}

function MarkdownDoc({ repo, gitRef, path, open }: { repo: string; gitRef: string; path: string; open: (path: string) => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    const ctl = new AbortController();
    setLoaded({ state: "loading" });
    fetchDoc(repo, path, ctl.signal)
      .then((d) => setLoaded({ state: "ok", text: d.text, truncated: d.truncated }))
      .catch(() => !ctl.signal.aborted && setLoaded({ state: "error" }));
    return () => ctl.abort();
  }, [repo, path]);

  // A link that climbs out of the repo resolves to nothing: it stays inert rather than guessing.
  const openLink = (href: string) => {
    const target = resolveDocLink(path, href);
    if (target) open(target);
  };

  if (loaded.state === "loading") return <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.loading")}</p>;
  if (loaded.state === "error") return <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.loadFailed", { ref: gitRef })}</p>;
  return (
    <>
      {loaded.truncated && <p className="text-xs text-muted-foreground">{t("docs.truncated")}</p>}
      <DocLinkContext.Provider value={openLink}>
        <MarkdownText text={loaded.text} />
      </DocLinkContext.Provider>
    </>
  );
}

/**
 * « Demander une modif » : the operator's words become a card on this repo, naming the file — the
 * agent that takes it opens the PR. The board itself never writes the repo.
 */
function AskEdit({ repo, gitRef, path }: { repo: string; gitRef: string; path: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const ask = text.trim();
    if (!ask || busy) return;
    setBusy(true);
    try {
      const { card } = await createCard({
        title: t("docs.ask.cardTitle", { path }),
        spec: `${t("docs.ask.cardFile", { path, ref: gitRef })}\n\n${ask}\n\n${t("docs.ask.cardHow")}`,
        repoPath: repo,
      });
      setStatus(t("docs.ask.created"), "success");
      void navigate(`/card/${encodeURIComponent(card.id)}`);
    } catch (e) {
      setStatus(t("docs.ask.failed", { why: e instanceof Error ? e.message : String(e) }), "error");
      setBusy(false);
    }
  };

  if (!open)
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <PencilLine />
        {t("docs.ask.open")}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("docs.ask.label")}
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={t("docs.ask.placeholder")}
          className={cn("w-full rounded-lg border border-border bg-background p-2 text-sm font-normal", FOCUS)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("docs.ask.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim() || busy}>
          {t("docs.ask.submit")}
        </Button>
      </div>
    </form>
  );
}
