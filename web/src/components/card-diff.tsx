import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronRight, FileDiff, FileText, GitBranch, RefreshCw } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { SectionLabel } from "@/components/ui/section-label";
import {
  boardErrorMessage,
  fetchDiffFile,
  fetchDiffStat,
  fetchWorktreeFile,
  patchCard,
  reviewCard,
  type DiffFile,
  type DiffStat,
} from "@/lib/board";
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
        <EmptyDiff cardId={cardId} onFixed={load} />
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

/**
 * An empty diff is more often the WRONG BASE REF than an idle agent: the card forked off a branch
 * that already contains the work, so `git diff <base>…HEAD` comes back empty and the copilot's
 * review duly reports that nothing changed. Reading that as "the agent did nothing" is what costs
 * the half hour — the diff is right, the question it was asked was wrong.
 *
 * So the way out is a button, not a diagnosis: put the base back on `main` and ask the copilot for
 * its verdict again. Two calls on purpose — the PATCH is the fix, the review is the re-read — and
 * they are two routes that each already mean one thing.
 */
function EmptyDiff({ cardId, onFixed }: { cardId: string; onFixed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebaseOnMain() {
    setBusy(true);
    setError(null);
    try {
      // ponytail: `main` literally, not the repo's resolved default branch — that would need a
      // `git symbolic-ref refs/remotes/origin/HEAD` round trip through the bridge. Add it the day a
      // repo on this board actually forks off `master`.
      await patchCard(cardId, { baseRef: "main" });
      await reviewCard(cardId);
      await onFixed();
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">
        Nothing changed on this branch — or the base ref it is measured from is the wrong one.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2"
        disabled={busy}
        onClick={() => void rebaseOnMain()}
      >
        <GitBranch className="size-4" />
        {busy ? "Re-measuring…" : "Base ref on main, review again"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
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

/**
 * Prose we can render, rather than a patch to squint at. Pure + exported for the test.
 *
 * Extension only, deliberately: the file list comes from git, so the name is all we have without a
 * second round trip, and `.md` is what a generated report is called.
 */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
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
  const [body, setBody] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The toggle remembers the FILE it was tapped on, not just a boolean: opening another file must
  // fall back to that file's own default, and a bare boolean reset in an effect would fetch once in
  // the stale mode before correcting itself.
  const [override, setOverride] = useState<{ path: string; prose: boolean } | null>(null);

  // A `.md` opens READ-FIRST — the point of tapping a report is to read it, and the patch is one tap
  // away. Every other file keeps exactly the diff it always had.
  const markdown = file !== null && isMarkdownPath(file.path);
  const prose = file !== null && (override?.path === file.path ? override.prose : markdown);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBody("");
    setError(null);
    const load = prose
      ? fetchWorktreeFile(cardId, file.path).then((r) => ({ body: r.text, truncated: r.truncated }))
      : fetchDiffFile(cardId, file.path, file.kind === "untracked").then((r) => ({
          body: r.diff,
          truncated: r.truncated,
        }));
    void load
      .then((r) => {
        if (cancelled) return;
        setBody(r.body);
        setTruncated(r.truncated);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, file, prose]);

  return (
    <BottomSheet open={file !== null} onClose={onClose} title={file?.path}>
      {markdown && file && (
        <button
          type="button"
          onClick={() => setOverride({ path: file.path, prose: !prose })}
          className="mb-2 flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
        >
          {prose ? <FileDiff className="size-3.5" /> : <BookOpen className="size-3.5" />}
          {prose ? "Show the diff" : "Read the document"}
        </button>
      )}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : prose ? (
        /* The reader. `MarkdownText` emits React elements only — the same XSS boundary the patch
           view holds, which matters just as much here: a report is whatever the agent wrote. */
        <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background p-3">
          {body.trim() === "" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" /> Empty file.
            </p>
          ) : (
            <MarkdownText text={body} className="text-sm leading-[1.6]" />
          )}
        </div>
      ) : (
        /* Wraps on a phone, panning-free; keeps column alignment from `sm:` up, where the width
           exists to show it. Pure CSS so it follows a rotation without a re-render — unlike the
           pane mirror, which has a user-facing toggle and so has to decide in JS. */
        <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background">
          <pre className="p-2 font-mono text-xs leading-snug sm:min-w-max">
            {body.split("\n").map((line, i) => (
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
          {prose ? "File" : "Diff"} truncated — open it on a laptop for the rest.
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
