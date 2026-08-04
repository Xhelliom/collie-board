import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FileDiff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { SectionLabel } from "@/components/ui/section-label";
import { fetchDiffFile, fetchDiffStat, type DiffFile, type DiffStat } from "@/lib/board";
import { cn } from "@/lib/utils";

// "What has the agent actually written." `--stat` first — a file list with bars is the only diff
// shape that reads on a phone — then tap a file for its unified patch.
//
// Fetched on demand and re-fetched when the card's status moves, NOT on the poll tick: a diff
// costs two git subprocesses, and it doesn't change while an agent thinks.
//
// Every line of the patch reaches the DOM as a TEXT NODE. That is the repo's XSS boundary
// (CLAUDE.md → Security posture) and it applies with full force here: a diff is attacker-influenced
// content by definition — it is literally whatever the agent, or a file it read, wrote.

export function CardDiff({ cardId, statusKey }: { cardId: string; statusKey: string }) {
  const [stat, setStat] = useState<DiffStat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<DiffFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStat(await fetchDiffStat(cardId));
      setError(null);
    } catch (e) {
      setStat(null);
      // A 409 here is the ordinary "not started yet" answer, not a failure worth shouting about.
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  // statusKey is in the deps on purpose: a status change is exactly when the diff has moved.
  useEffect(() => {
    void load();
  }, [load, statusKey]);

  if (error && !stat) return null;

  const total = stat ? stat.added + stat.removed : 0;
  const max = stat ? Math.max(1, ...stat.files.map((f) => f.added + f.removed)) : 1;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SectionLabel>Diff</SectionLabel>
        {stat && (
          <span className="text-xs text-muted-foreground/70">
            {stat.files.length} fichier{stat.files.length === 1 ? "" : "s"}
            {total > 0 && (
              <>
                {" · "}
                <span className="text-status-done">+{stat.added}</span>{" "}
                <span className="text-status-blocked">−{stat.removed}</span>
              </>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh diff"
          className="ml-auto p-1 text-muted-foreground"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {stat && stat.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing changed on this branch yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {stat?.files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setOpen(f)}
              className="flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]"
            >
              <FileDiff className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
              {f.kind === "untracked" ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  new
                </span>
              ) : f.kind === "binary" ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  bin
                </span>
              ) : (
                <StatBar added={f.added} removed={f.removed} max={max} />
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <FileDiffSheet cardId={cardId} file={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** The classic `--stat` bar, scaled to the busiest file so one huge file doesn't flatten the rest. */
function StatBar({ added, removed, max }: { added: number; removed: number; max: number }) {
  const width = 8; // segments — a phone has no room for git's 60
  const plus = Math.round((added / max) * width);
  const minus = Math.round((removed / max) * width);
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-muted-foreground">{added + removed}</span>{" "}
      <span className="text-status-done">{"+".repeat(Math.min(plus, width))}</span>
      <span className="text-status-blocked">{"−".repeat(Math.min(minus, width))}</span>
    </span>
  );
}

function FileDiffSheet({
  cardId,
  file,
  onClose,
}: {
  cardId: string;
  file: DiffFile | null;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setDiff("");
    setError(null);
    void fetchDiffFile(cardId, file.path, file.kind === "untracked")
      .then((r) => {
        if (cancelled) return;
        setDiff(r.diff);
        setTruncated(r.truncated);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, file]);

  return (
    <BottomSheet open={file !== null} onClose={onClose} title={file?.path}>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        /* Wraps on a phone, panning-free; keeps column alignment from `sm:` up, where the width
           exists to show it. Pure CSS so it follows a rotation without a re-render — unlike the
           pane mirror, which has a user-facing toggle and so has to decide in JS. */
        <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background">
          <pre className="p-2 font-mono text-xs leading-snug sm:min-w-max">
            {diff.split("\n").map((line, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal",
                  lineClass(line),
                )}
              >
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
      {truncated && (
        <p className="pt-2 text-xs text-muted-foreground">
          Diff truncated — open it on a laptop for the rest.
        </p>
      )}
      <Button variant="outline" onClick={onClose} className="mt-3 h-11 w-full">
        Close
      </Button>
    </BottomSheet>
  );
}

/**
 * Colour one unified-diff line by its prefix. `+++`/`---` are FILE HEADERS, not content, so they
 * must be checked before the single-character add/remove cases or every patch opens with a green
 * and a red line that mean nothing.
 */
export function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-status-working";
  if (line.startsWith("+")) return "text-status-done";
  if (line.startsWith("-")) return "text-status-blocked";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-muted-foreground";
  return "";
}
