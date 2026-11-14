import { Link } from "react-router";
import { Maximize2, Star } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n";
import { pageTab, pageUrl, usePageTabs } from "@/lib/docs";
import { cn } from "@/lib/utils";

// The Project page's showcase: the one ticked tab the operator put « En vitrine », at the head of the page,
// for a project that is not code (a marketing plan, an offer, an art direction). The same inert frame as its
// tab (ADR 0053): sandbox with no allowance, the page under its own CSP. No showcase, nothing drawn.

export function ProjectShowcase({ repo }: { repo: string }) {
  const t = useT();
  const key = usePageTabs(repo)?.showcase;
  if (!key) return null;
  const tab = pageTab(repo, key);
  return (
    <section aria-label={t("docs.pages.showcaseTitle")} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Star className="size-4 shrink-0 fill-primary text-primary" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug">{tab.label}</h2>
        <Link to={`${tab.to}&full=1`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-11 shrink-0 gap-1.5 text-xs sm:h-8")}>
          <Maximize2 className="size-3.5" aria-hidden="true" />
          {t("docs.pages.openFull")}
        </Link>
      </div>
      <iframe
        title={t("docs.page.frame", { name: tab.label })}
        sandbox=""
        src={pageUrl(repo, tab.name, tab.card)}
        className="h-[min(60vh,560px)] w-full rounded-xl border bg-white shadow-(--shadow-2)"
      />
    </section>
  );
}
