import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { CardStatusChip } from "@/components/card-status-chip";
import { SectionLabel } from "@/components/ui/section-label";
import { boardPath, cardPath, repoName, type CardView } from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { projectOf, type ProjectPhase } from "@/lib/project";
import { cn } from "@/lib/utils";

// The project view: one repo's board read as a road map. Read-only and derived (lib/project.ts) —
// the phases are containers, the steps their sub-tasks, "waiting for you" is what is blocked or in
// review. Polling is the root's, like every board route.

const SEG: Partial<Record<CardView["status"], string>> = {
  done: "bg-status-done",
  working: "bg-status-working",
  starting: "bg-status-working",
  review: "bg-status-done/50",
  blocked: "bg-status-blocked",
};

function Segments({ steps }: { steps: CardView[] }) {
  return (
    <div className="flex gap-0.5" aria-hidden="true">
      {steps.map((s) => (
        <i key={s.id} className={cn("h-1.5 flex-1 rounded-full bg-muted", SEG[s.status])} />
      ))}
    </div>
  );
}

function StepRow({ card, next }: { card: CardView; next: boolean }) {
  return (
    <Link to={cardPath(card.id)} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent/50">
      <span className="min-w-0 flex-1 truncate text-sm">{card.title}</span>
      {next && <span className="rounded-full bg-brand/15 px-2 py-px text-[11px] font-semibold text-brand">next</span>}
      <CardStatusChip status={card.status} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function Phase({ phase, nextId }: { phase: ProjectPhase; nextId: string | undefined }) {
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{phase.container?.title ?? "No phase"}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {phase.done} / {phase.steps.length}
        </span>
      </div>
      <Segments steps={phase.steps} />
      <div className="flex flex-col">
        {phase.steps.map((s) => (
          <StepRow key={s.id} card={s} next={s.id === nextId} />
        ))}
      </div>
    </section>
  );
}

export function ProjectRoute() {
  const navigate = useNavigate();
  const data = useLoaderData() as BoardData;
  const repo = useSearchParams()[0].get("repo");
  const cards = repo ? data.cards.filter((c) => c.repoPath === repo) : data.cards;
  const v = projectOf(cards);
  const pct = v.total ? Math.round((100 * v.done) / v.total) : 0;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        title={repo ? repoName(repo) : "Project"}
        subtitle={`${v.done} / ${v.total} done · ${v.active} in flight`}
        onBack={() => navigate(boardPath())}
      />
      <h1 className="sr-only">Project</h1>
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24 lg:p-5">
        {v.total === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            No cards{repo ? " in this repo" : ""} yet. Split a card into sub-tasks to make a phase.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-[14px] border bg-card p-3">
              <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
              <div className="flex-1">
                <Segments steps={v.phases.flatMap((p) => p.steps)} />
              </div>
            </div>
            {v.awaiting.length > 0 && (
              <section className="flex flex-col gap-1 rounded-[14px] border border-status-blocked/40 bg-card p-3">
                <SectionLabel>Waiting for you · {v.awaiting.length}</SectionLabel>
                {v.awaiting.map((c) => (
                  <StepRow key={c.id} card={c} next={false} />
                ))}
              </section>
            )}
            {v.phases.map((p) => (
              <Phase key={p.container?.id ?? "loose"} phase={p} nextId={v.next?.id} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
