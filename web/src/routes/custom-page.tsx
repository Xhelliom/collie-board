import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Maximize2, ShieldCheck, Star, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { useT } from "@/i18n";
import { loadRepoScope, repoName } from "@/lib/board";
import { pageKey, pageUrl, setShowcase, usePageTabs } from "@/lib/docs";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// One HTML page of the project — `docs/pages/<name>.html` on main, or a card's HTML deliverable
// (`?card=<id>&name=<file>`) — shown as a tab when the operator ticked it in Documents › Pages. Agent HTML is
// untrusted: the bridge scrubs it and serves it under its own sandbox CSP, and the iframe is sandboxed
// with NO allowance — no script, no same-origin, so it can neither read the board nor call /api.
// ADR 0053. Full screen is a fixed overlay, not the Fullscreen API (absent on iPhone).

export function CustomPageRoute() {
  const [params] = useSearchParams();
  const repo = params.get("repo") ?? loadRepoScope();
  const name = params.get("name") ?? "";
  const card = params.get("card");
  const t = useT();
  // The tab's « ⋯ »: put it at the head of the Project page, or take it down. Offered once it is a tab.
  const key = pageKey({ name, cardId: card ?? undefined });
  const listing = usePageTabs(repo);
  const pinned = listing?.showcase === key;
  const pin = () =>
    repo &&
    setShowcase(repo, pinned ? null : key).catch((e: unknown) => setStatus(t("docs.pages.tabFailed", { why: e instanceof Error ? e.message : String(e) }), "error"));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        children={<RepoTitle repos={repo ? [{ path: repo, name: repoName(repo) }] : []} subtitle={card ? name.replace(/\.html?$/i, "") : name} />}
        rightTrail={
          listing?.tabs.includes(key) && (
            <MoreActions label={t("docs.pages.more")}>
              <button type="button" role="menuitem" onClick={() => void pin()} className={MENU_ITEM}>
                <Star className={cn("size-4", pinned && "fill-primary text-primary")} aria-hidden="true" />
                {t(pinned ? "docs.pages.showcaseUnset" : "docs.pages.showcaseSet")}
              </button>
            </MoreActions>
          )
        }
      />
      <BoardTabs />
      <main className="flex min-h-0 flex-1 flex-col p-3 pb-24 lg:p-5">{repo && name && <PageFrame repo={repo} name={name} card={card} full={params.get("full") === "1"} />}</main>
    </div>
  );
}

/** The sandboxed frame and its full-screen button — the tab's and the Documents tree's, one of each. */
/** `full`: open already in full screen — the Project page's showcase links here with `&full=1`. */
export function PageFrame({ repo, name, card, full: startFull = false }: { repo: string; name: string; card?: string | null; full?: boolean }) {
  const t = useT();
  const [full, setFull] = useState(startFull);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", full && "fixed inset-0 z-50 bg-background")}>
      <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        <span className="flex-1">{t("docs.page.note")}</span>
        <button
          type="button"
          onClick={() => setFull(!full)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-muted/60"
        >
          {full ? <X className="size-4" /> : <Maximize2 className="size-4" />}
          {t(full ? "docs.page.exit" : "docs.page.fullscreen")}
        </button>
      </div>
      <iframe
        title={t("docs.page.frame", { name })}
        sandbox=""
        src={pageUrl(repo, name, card)}
        className={cn("min-h-[60vh] w-full flex-1 bg-white", full ? "border-t" : "rounded-md border")}
      />
    </div>
  );
}
