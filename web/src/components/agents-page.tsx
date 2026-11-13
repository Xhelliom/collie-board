import { ChevronRight, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { agentsPage, DEFAULT_FILTERS, type AgentsFilters, type ProjectGroup } from "@/lib/agents-page";
import type { AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentLine } from "./agent-line";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";

// The filters, remembered on this device (not the search: a search is for now). The compact list
// keeps its own: narrowing the page to « à traiter » must not empty the pane column.
function useFilters(key: string): [AgentsFilters, (f: Partial<AgentsFilters>) => void] {
  const [f, setF] = useState<AgentsFilters>(() => {
    try {
      return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const set = (p: Partial<AgentsFilters>) => {
    const next = { ...f, ...p };
    setF(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  return [f, set];
}

interface AgentsPageProps {
  herd: AgentView[];
  /** The board's own panes (lead, copilot): never listed. */
  internal: ReadonlySet<string>;
  /** This machine plus every paired peer, for « sur X machines ». */
  machineCount?: number;
  onOpen: (paneId: string) => void;
  onNew?: () => void;
  /** The pane column and the phone's pane switcher: no title nor search, the filters folded behind an icon. */
  compact?: boolean;
  /** The pane open beside the list — highlighted. */
  current?: string;
  /** Compact: the column's own header, the filters icon at its end. */
  title?: string;
}

/**
 * The Agents page: a sentence, the filters, then one group per project and one line per agent.
 * The same list, `compact`, is the agent view's pane column and the phone's pane switcher.
 */
export function AgentsPageView({ herd, internal, machineCount = 1, onOpen, onNew, compact = false, current, title }: AgentsPageProps) {
  const t = useT();
  const [f, setF] = useFilters(compact ? "collie-agents-filters-compact" : "collie-agents-filters");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [restingOpen, setRestingOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const page = agentsPage(herd, f, query, internal, t("agents.orchestrator"));
  const { counts } = page;
  const group = (g: ProjectGroup) => <Group key={g.project} group={g} onOpen={onOpen} compact={compact} current={current} />;

  const sentence = [
    counts.needs > 0 && t("agents.sum.needs", { count: counts.needs }),
    counts.working > 0 && t("agents.sum.working", { count: counts.working }),
    counts.idle > 0 && t("agents.sum.idle", { count: counts.idle }),
  ].filter(Boolean);
  const empty = page.live.length + page.resting.length === 0;
  // A filtered machine that has since left the herd would hide everything with no chip to undo it.
  const machines = f.machine && !page.machines.includes(f.machine) ? [...page.machines, f.machine] : page.machines;

  return (
    <div className={compact ? "flex w-full flex-col gap-3 px-2 pb-3" : "mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-12 lg:py-8"}>
      {compact ? (
        <div className={cn("flex items-center", title && "-mx-2 h-14 flex-none border-b border-border/60 px-2 pl-4")}>
          {title && <span className="flex-1 text-sm font-semibold">{title}</span>}
        <button
          type="button"
          aria-label={t("agents.filters")}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="ml-auto flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60"
        >
          <SlidersHorizontal className="size-4" />
        </button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] sm:text-[26px]">{t("nav.agents")}</h1>
          {sentence.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {sentence.join(", ")}
              {machineCount > 1 && `, ${t("agents.sum.machines", { count: machineCount })}`}.
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t("agents.searchOpen")}
          aria-expanded={searching}
          onClick={() => setSearching(!searching)}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
        >
          <Search className="size-5" />
        </button>
        <label
          className={cn(
            "order-last h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/50 lg:order-none lg:flex lg:w-72",
            searching ? "flex" : "hidden",
          )}
        >
          <Search className="size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agents.search")}
            aria-label={t("agents.search")}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
        <Button variant="outline" onClick={onNew} aria-label={t("agents.new")} className="size-11 p-0 lg:size-auto lg:h-10 lg:px-3.5">
          <Plus className="size-4" />
          <span className="hidden lg:inline">{t("agents.new")}</span>
        </Button>
      </div>
      )}

      {/* One scrolling row on a phone, wrapping on a wide screen — and always wrapping, folded, in a narrow column. */}
      {(!compact || filtersOpen) && (
      <div
        role="group"
        aria-label={t("agents.filters")}
        className={compact ? "flex flex-wrap gap-2" : "-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0"}
      >
        <Chip label={t("agents.filter.all")} active={f.state === "all"} onClick={() => setF({ state: "all" })} />
        {(["needs", "working", "idle"] as const).map((s) => (
          <Chip key={s} label={t(`agents.filter.${s}`, { count: counts[s] })} active={f.state === s} onClick={() => setF({ state: f.state === s ? "all" : s })} />
        ))}
        {machines.length > 0 && (
          <>
            <span aria-hidden="true" className="w-2 shrink-0" />
            {["", ...machines].map((m) => (
              <Chip key={m} label={m || t("home.machine.this")} active={f.machine === m} onClick={() => setF({ machine: f.machine === m ? null : m })} />
            ))}
          </>
        )}
        <span aria-hidden="true" className="w-2 shrink-0 lg:flex-1" />
        <Chip label={t("agents.filter.hideOrch")} active={f.hideOrch} onClick={() => setF({ hideOrch: !f.hideOrch })} />
        <Chip label={t("agents.filter.terminals")} active={f.terminals} onClick={() => setF({ terminals: !f.terminals })} />
      </div>
      )}

      {empty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t(herd.length === 0 ? "agents.none" : "agents.noMatch")}</p>
      ) : (
        <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
          {page.live.map(group)}
          {page.resting.length > 0 &&
            // The open pane is never folded away.
            (page.live.length === 0 || restingOpen || page.resting.some((g) => g.agents.some((a) => a.paneId === current)) ? (
              page.resting.map(group)
            ) : (
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setRestingOpen(true)}
                className="flex min-h-11 items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="size-4" />
                {t("agents.resting", { count: page.resting.length })}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Group({ group, onOpen, compact, current }: { group: ProjectGroup; onOpen: (paneId: string) => void; compact: boolean; current?: string }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-1" aria-label={group.project}>
      <h2 className={cn("mb-1 flex items-baseline gap-2.5 font-semibold", compact ? "px-2.5 text-[13px]" : "text-[15px]")}>
        <span className="min-w-0 truncate">{group.project}</span>
        <span className="shrink-0 text-[13px] font-normal text-muted-foreground">{t("agents.count", { count: group.agents.length })}</span>
      </h2>
      {group.agents.map((a) => <AgentLine key={a.paneId} agent={a} onOpen={onOpen} compact={compact} current={a.paneId === current} />)}
    </section>
  );
}
