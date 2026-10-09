import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { boardErrorMessage, type Decision, type DecisionStatus, type Roadmap, type RoadmapItem, type RoadmapStatus } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The roadmap (ADR 0021, 0023): a document the orchestrator writes WITH the operator — a vision,
// phases each with their long form, and the journal of decisions marked ✅ decided / 🟡 leaning /
// ❓ open. Read-only here; the page shows it and hands out the two Markdown exports, one way, for
// whoever commits them to the repo. The step-by-step one is rendered by the bridge from the board's
// own phases, lots and cards, so it is not authored anywhere.

const DOT: Record<RoadmapStatus, string> = {
  planned: "bg-muted-foreground/50",
  active: "bg-status-working",
  done: "bg-status-done",
  dropped: "bg-muted-foreground/30",
};

const DECISION: Record<DecisionStatus, { mark: string; label: string }> = {
  decided: { mark: "✅", label: "Decided" },
  leaning: { mark: "🟡", label: "Leaning" },
  open: { mark: "❓", label: "Open questions" },
};
const ORDER: DecisionStatus[] = ["decided", "leaning", "open"];

function Phase({ item, index, decisions, open, onToggle }: { item: RoadmapItem; index: number; decisions: Decision[]; open: boolean; onToggle: () => void }) {
  const body = `roadmap-${item.id}`;
  return (
    <li className="rounded-xl border bg-background/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={body}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-baseline gap-x-2.5 px-3 py-2.5 text-left text-sm"
      >
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <span className={cn("min-w-0", item.status === "dropped" && "text-muted-foreground line-through")}>
          <b className="font-semibold">{item.name}</b>
          {item.goal && <span className="text-muted-foreground"> — {item.goal}</span>}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className={cn("size-2 rounded-full", DOT[item.status])} />
          {item.status}
        </span>
        <ChevronDown className={cn("size-4 self-center text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      {open && (
        <div id={body} className="flex flex-col gap-2.5 border-t px-3 py-3 pl-9">
          {item.detail ? (
            <div className="max-h-96 overflow-y-auto text-muted-foreground">
              <MarkdownText text={item.detail} className="text-sm" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No detail yet — the orchestrator writes the objective, the end-of-phase demo, the risk and the why here.</p>
          )}
          {decisions.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground" aria-label="Decisions of this phase">
              {decisions.map((d) => (
                <li key={d.id}>
                  <span aria-hidden="true">{DECISION[d.status].mark} </span>
                  {d.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function ProjectRoadmap({ repo, roadmap }: { repo: string; roadmap: Roadmap | null }) {
  const [open, setOpen] = useState(true);
  // The active phase opens by itself — that is where the brainstorm is; the rest stay folded.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set((roadmap?.items ?? []).filter((i) => i.status === "active").map((i) => i.id)));
  const items = roadmap?.items ?? [];
  const decisions = roadmap?.decisions ?? [];
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function copy(format: "md" | "steps") {
    try {
      const res = await fetch(`/api/roadmap?repo=${encodeURIComponent(repo)}&format=${format}`);
      if (!res.ok) throw new Error(`${res.status}`);
      await navigator.clipboard.writeText(await res.text());
      setStatus(format === "md" ? "Detailed roadmap copied as Markdown." : "Step-by-step roadmap copied as Markdown.", "success");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  const copyButton = "inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium hover:border-foreground/25";
  return (
    <section aria-label="Roadmap" className="flex flex-col gap-2 rounded-2xl border bg-card/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-2 text-left">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Roadmap</span>
          {items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>}
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
        </button>
        {roadmap && (
          <>
            <button type="button" onClick={() => void copy("md")} className={copyButton}>
              <Copy className="size-3.5" />
              Copy the detailed roadmap
            </button>
            <button type="button" onClick={() => void copy("steps")} className={copyButton}>
              <Copy className="size-3.5" />
              Copy the step by step
            </button>
          </>
        )}
      </div>
      {open &&
        (roadmap ? (
          <div className="flex flex-col gap-3">
            {roadmap.vision && <MarkdownText text={roadmap.vision} className="text-sm text-muted-foreground" />}
            <ol className="flex flex-col gap-1.5">
              {items.map((it, i) => (
                <Phase
                  key={it.id}
                  item={it}
                  index={i}
                  decisions={decisions.filter((d) => d.itemId === it.id)}
                  open={openIds.has(it.id)}
                  onToggle={() => toggle(it.id)}
                />
              ))}
            </ol>
            {decisions.length > 0 && (
              <div aria-label="Decision journal" className="flex flex-col gap-2 border-t pt-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Decisions</span>
                  {ORDER.map((s) => (
                    <span key={s} className="tabular-nums text-muted-foreground">
                      {DECISION[s].mark} {decisions.filter((d) => d.status === s).length} {DECISION[s].label.toLowerCase()}
                    </span>
                  ))}
                </div>
                {ORDER.map((s) => {
                  const group = decisions.filter((d) => d.status === s);
                  if (!group.length) return null;
                  return (
                    <ul key={s} aria-label={DECISION[s].label} className="flex flex-col gap-1 text-sm">
                      {group.map((d) => {
                        const phase = items.find((i) => i.id === d.itemId);
                        return (
                          <li key={d.id} className="flex gap-2">
                            <span aria-hidden="true">{DECISION[s].mark}</span>
                            <span className="min-w-0">
                              {d.text}
                              {phase && <span className="text-muted-foreground"> — {phase.name}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No roadmap yet. Start the brainstorm with the project orchestrator: it asks one theme at a time and writes the
            vision, each phase and every decision here as you settle them.
          </p>
        ))}
    </section>
  );
}
