import { useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ChevronRight, FileText, PencilLine, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs } from "@/components/board-tabs";
import { DocLinkContext, MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { useT } from "@/i18n";
import { createCard, repoName } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { decisionStatus, docMatches, fetchDoc, resolveDocLink, searchDocs, type DecisionStatus, type DocDecision, type DocEntry, type DocsIndex } from "@/lib/docs";
import { cn } from "@/lib/utils";

// The Documents tab: the repo's Markdown as it stands on its default branch, one section per rubric
// of the doc convention, the decisions (ADRs + roadmap) on top. `?doc=<path>` reads one, rendered by
// the transcript's Markdown renderer — text nodes only — with its relative `.md` links opened in place.

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const ROW = cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60", FOCUS);
/** Text search waits for the typing to settle — a request per keystroke would be a poll by another name. */
const SEARCH_DELAY_MS = 300;
/** Decisions shown before « See the N decisions »: enough to read what moved, short enough to reach the rubrics. */
const DECISIONS_PREVIEW = 5;
const STATUSES: readonly DecisionStatus[] = ["decided", "leaning", "open"];

export function DocumentsRoute() {
  const t = useT();
  const { repo, index } = useLoaderData() as { repo: string | null; index: DocsIndex | null };
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const doc = params.get("doc");
  const at = (path: string | null) => `/board/documents?repo=${encodeURIComponent(repo ?? "")}${path ? `&doc=${encodeURIComponent(path)}` : ""}`;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title={t("docs.title")} subtitle={index ? t("docs.onRef", { ref: index.ref }) : undefined} />
      <BoardTabs repos={repo ? [{ path: repo, name: repoName(repo) }] : []} />
      <h1 className="sr-only">{t("docs.title")}</h1>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-24 lg:p-5">
        {!repo || !index ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.pickRepo")}</p>
        ) : doc ? (
          <DocView repo={repo} gitRef={index.ref} path={doc} backTo={at(null)} open={(p) => void navigate(at(p))} />
        ) : (
          <DocList repo={repo} index={index} hrefOf={at} />
        )}
      </main>
    </div>
  );
}

function DocList({ repo, index, hrefOf }: { repo: string; index: DocsIndex; hrefOf: (path: string) => string }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [inText, setInText] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
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

  const keep = (d: DocEntry) => docMatches(d, query, inText);
  const sections = [...index.rubrics, { id: "other", label: t("docs.other"), docs: index.other }]
    .map((r) => ({ ...r, docs: r.docs.filter(keep) }))
    .filter((r) => r.docs.length > 0);
  const needle = query.trim().toLowerCase();
  const decisions = index.decisions.filter(
    (d) =>
      (statuses.size === 0 || statuses.has(decisionStatus(d))) &&
      (d.kind === "adr" ? keep({ path: d.path, title: d.title, size: 0 }) : !needle || d.text.toLowerCase().includes(needle)),
  );
  const total = index.rubrics.reduce((n, r) => n + r.docs.length, index.other.length);
  // A search shows every hit: the five-line preview is for browsing, not for finding.
  const preview = !showAll && !needle && decisions.length > DECISIONS_PREVIEW;
  const shown = preview ? decisions.slice(0, DECISIONS_PREVIEW) : decisions;
  const nav = [
    ...(index.decisions.length > 0 ? [{ id: "decisions", label: t("docs.decisions") }] : []),
    ...sections.map((r) => ({ id: r.id, label: r.label })),
  ];
  const toggle = (id: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const jump = (id: string) => {
    setClosed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : c));
    document.getElementById(`docs-${id}`)?.scrollIntoView({ block: "start" });
  };
  const flip = (s: DecisionStatus) =>
    setStatuses((c) => {
      const next = new Set(c);
      if (!next.delete(s)) next.add(s);
      return next;
    });

  return (
    <div className="flex w-full flex-col gap-4">
      <label className="relative">
        <span className="sr-only">{t("docs.search")}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // A new search unfolds everything, so a hit is never hidden in a section folded earlier.
            setClosed(new Set());
          }}
          placeholder={t("docs.search")}
          className={cn("h-10 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm", FOCUS)}
        />
      </label>

      {nav.length > 1 && (
        <nav aria-label={t("docs.sections")} className="sticky -top-3 z-10 -mx-3 -my-2 flex gap-1.5 overflow-x-auto bg-background px-3 py-2 lg:-top-5 lg:-mx-5 lg:px-5">
          {nav.map((n) => (
            <Chip key={n.id} label={n.label} active={false} onClick={() => jump(n.id)} />
          ))}
        </nav>
      )}

      {total === 0 && index.decisions.length === 0 ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.empty", { ref: index.ref })}</p>
      ) : sections.length === 0 && decisions.length === 0 ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.noMatch")}</p>
      ) : null}

      {index.decisions.length > 0 && (!needle || decisions.length > 0) && (
        <Section id="decisions" label={t("docs.decisions")} count={decisions.length} open={!closed.has("decisions")} onToggle={toggle}>
          <div role="group" aria-label={t("docs.statusFilter")} className="flex flex-wrap gap-1.5 px-1 pb-1">
            {STATUSES.map((s) => (
              <Chip key={s} label={t(`docs.status.${s}`)} active={statuses.has(s)} onClick={() => flip(s)} />
            ))}
          </div>
          {shown.map((d) => (
            <DecisionRow key={d.kind === "adr" ? d.path : d.id} decision={d} href={d.kind === "adr" ? hrefOf(d.path) : null} clamp={preview} />
          ))}
          {preview && (
            <button type="button" onClick={() => setShowAll(true)} className={cn(ROW, "justify-center font-semibold text-primary")}>
              {t("docs.seeAll", { count: decisions.length })}
            </button>
          )}
        </Section>
      )}

      {sections.map((r) => (
        <Section key={r.id} id={r.id} label={r.label} count={r.docs.length} open={!closed.has(r.id)} onToggle={toggle}>
          {r.docs.map((d) => (
            <Link key={d.path} to={hrefOf(d.path)} className={ROW}>
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{d.path}</span>
              </span>
            </Link>
          ))}
        </Section>
      ))}
    </div>
  );
}

function Section({ id, label, count, open, onToggle, children }: { id: string; label: string; count: number; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    // scroll-mt clears the sticky bar when a chip jumps here.
    <section id={`docs-${id}`} className="flex scroll-mt-14 flex-col gap-1">
      <button type="button" aria-expanded={open} onClick={() => onToggle(id)} className={cn("flex items-center gap-1.5 rounded-lg px-1 py-1 text-left hover:bg-muted/60", FOCUS)}>
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-90")} />
        <SectionLabel>{label}</SectionLabel>
        <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

function DecisionRow({ decision: d, href, clamp }: { decision: DocDecision; href: string | null; clamp: boolean }) {
  const t = useT();
  const status = d.kind === "roadmap" ? t(`docs.status.${d.status}`) : d.status;
  const body = (
    <span className="min-w-0 flex-1">
        <span className={cn("block font-medium", clamp && "truncate")}>{d.kind === "adr" ? d.title : d.text}</span>
        <span className={cn("flex gap-x-2 text-xs text-muted-foreground", clamp ? "whitespace-nowrap" : "flex-wrap")}>
          {status && <span className="min-w-0 truncate">{status}</span>}
          {d.date && <span className="shrink-0">{d.date}</span>}
          {d.kind === "roadmap" && <span className="shrink-0">{t("docs.roadmap")}</span>}
        </span>
    </span>
  );
  return href ? (
    <Link to={href} className={ROW}>
      {body}
    </Link>
  ) : (
    <div className="flex w-full items-center gap-2 px-2.5 py-2 text-sm">{body}</div>
  );
}

type Loaded = { state: "loading" } | { state: "error" } | { state: "ok"; text: string; truncated: boolean };

function DocView({ repo, gitRef, path, backTo, open }: { repo: string; gitRef: string; path: string; backTo: string; open: (path: string) => void }) {
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

  return (
    <article className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link to={backTo} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold hover:bg-muted/60", FOCUS)}>
          <ArrowLeft className="size-4" />
          {t("docs.back")}
        </Link>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">{path}</span>
      </div>
      <AskEdit repo={repo} gitRef={gitRef} path={path} />
      {loaded.state === "loading" ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.loading")}</p>
      ) : loaded.state === "error" ? (
        <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("docs.loadFailed", { ref: gitRef })}</p>
      ) : (
        <>
          {loaded.truncated && <p className="text-xs text-muted-foreground">{t("docs.truncated")}</p>}
          <DocLinkContext.Provider value={openLink}>
            <MarkdownText text={loaded.text} />
          </DocLinkContext.Provider>
        </>
      )}
    </article>
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
