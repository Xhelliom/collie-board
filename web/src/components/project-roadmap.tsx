import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { boardErrorMessage, type Roadmap, type RoadmapStatus } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The roadmap (ADR 0021): the repo's intents, above its phases. Read-only here — the planning
// orchestrator or the collie-board skill writes it; this page only shows it and hands out the
// Markdown, one way, for whoever commits it to the repo.

const DOT: Record<RoadmapStatus, string> = {
  planned: "bg-muted-foreground/50",
  active: "bg-status-working",
  done: "bg-status-done",
  dropped: "bg-muted-foreground/30",
};

export function ProjectRoadmap({ repo, roadmap }: { repo: string; roadmap: Roadmap | null }) {
  const [open, setOpen] = useState(true);
  const items = roadmap?.items ?? [];

  async function copy() {
    try {
      const res = await fetch(`/api/roadmap?repo=${encodeURIComponent(repo)}&format=md`);
      if (!res.ok) throw new Error(`${res.status}`);
      await navigator.clipboard.writeText(await res.text());
      setStatus("Roadmap copied as Markdown.", "success");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <section aria-label="Roadmap" className="flex flex-col gap-2 rounded-2xl border bg-card/70 p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Roadmap</span>
          {items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>}
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
        </button>
        {roadmap && (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium hover:border-foreground/25"
          >
            <Copy className="size-3.5" />
            Copy as Markdown
          </button>
        )}
      </div>
      {open &&
        (roadmap ? (
          <div className="flex flex-col gap-3">
            {roadmap.vision && <MarkdownText text={roadmap.vision} className="text-sm text-muted-foreground" />}
            <ol className="flex flex-col gap-1.5">
              {items.map((it, i) => (
                <li key={it.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-sm">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className={cn("min-w-0", it.status === "dropped" && "text-muted-foreground line-through")}>
                    <b className="font-semibold">{it.name}</b>
                    {it.goal && <span className="text-muted-foreground"> — {it.goal}</span>}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <span className={cn("size-2 rounded-full", DOT[it.status])} />
                    {it.status}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No roadmap yet. The project orchestrator (or the collie-board skill) writes it; it shows up here.
          </p>
        ))}
    </section>
  );
}
