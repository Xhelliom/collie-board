import { SendButton } from "@/components/ui/chat/send-button";
import { useT } from "@/i18n";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronRight, FileDiff, FileText, MessageSquare, RefreshCw, X } from "lucide-react";

import { useFold } from "@/components/fold";
import { MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { Panel } from "@/components/card-panel";
import {
  boardErrorMessage,
  fetchDiffFile,
  fetchDiffStat,
  fetchWorktreeFile,
  type DiffFile,
  type DiffStat,
} from "@/lib/board";
import { isApiErrorStatus } from "@/lib/api";
import { formatBatch, loadComments, lineKey, makeComment, numberDiff, saveComments, type DiffComment } from "@/lib/diff-comments";
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

/**
 * `remote`: the checkout is on a peer, which serves the patch but never a file to read.
 * `onSend`: the card's live agent takes a prompt — only then can lines be commented on.
 */
export function CardDiff({
  cardId,
  statusKey,
  remote = false,
  alreadyPresent = false,
  onSend,
}: {
  cardId: string;
  statusKey: string;
  remote?: boolean;
  alreadyPresent?: boolean;
  onSend?: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [stat, setStat] = useState<DiffStat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notStarted, setNotStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<DiffFile | null>(null);
  // The batch of line comments, kept across a Back (sessionStorage) until it is sent.
  const [comments, setComments] = useState<DiffComment[]>(() => loadComments(cardId));
  const [sending, setSending] = useState(false);
  useEffect(() => saveComments(cardId, comments), [cardId, comments]);

  const send = async () => {
    if (!onSend) return;
    setSending(true);
    try {
      await onSend(formatBatch(t("diff.comment.intro"), comments));
      setComments([]);
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  // 57 files were ~2200 px in the middle of the card: the first eight, the rest behind a count.
  const { shown, toggle } = useFold(stat?.files ?? [], 8);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStat(await fetchDiffStat(cardId));
      setError(null);
      setNotStarted(false);
    } catch (e) {
      setStat(null);
      // A 409 here is the ordinary "not started yet" answer, not a failure worth shouting about.
      setNotStarted(isApiErrorStatus(e, 409));
      setError(boardErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  // statusKey is in the deps on purpose: a status change is exactly when the diff has moved.
  useEffect(() => {
    void load();
  }, [load, statusKey]);

  if (notStarted && !stat) return null;

  const total = stat ? stat.added + stat.removed : 0;
  const max = stat ? Math.max(1, ...stat.files.map((f) => f.added + f.removed)) : 1;

  return (
    <Panel
      title={t("fiche.changed")}
      count={
        stat && (
          <>
            {t("diff.files", { count: stat.files.length })}
            {total > 0 && (
              <>
                {", "}
                <span className="text-status-done">+{stat.added}</span>{" "}
                <span className="text-destructive">−{stat.removed}</span>
              </>
            )}
          </>
        )
      }
      actions={
        <button type="button" onClick={() => void load()} aria-label={t("diff.refresh")} className="p-1 text-muted-foreground">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      }
    >
      {error && !stat && <p className="text-xs text-destructive">{t("diff.error", { error })}</p>}

      {stat && stat.files.length === 0 ? (
        // No way out offered here on purpose: the base is the bridge's one answer (`baseOf`), and a
        // button writing `main` broke dependent cards and was offered on merged ones.
        <p className="text-xs text-muted-foreground">{t(alreadyPresent ? "diff.alreadyPresent" : "diff.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setOpen(f)}
              className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]"
            >
              <FileDiff className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
              {f.kind === "untracked" ? (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {t("diff.new")}
                </span>
              ) : f.kind === "binary" ? (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {t("diff.bin")}
                </span>
              ) : (
                <StatBar added={f.added} removed={f.removed} max={max} />
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {toggle}
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border bg-card p-2.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquare className="size-3.5" />
            {t("diff.comment.batch", { count: comments.length })}
          </span>
          {comments.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="min-w-0 flex-1">
                <span className="font-mono text-muted-foreground">
                  {c.path} ({c.label})
                </span>{" "}
                {c.note}
              </span>
              <button
                type="button"
                aria-label={t("diff.comment.remove")}
                onClick={() => setComments((cs) => cs.filter((_, j) => j !== i))}
                className="shrink-0 p-0.5 text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {onSend && (
            <SendButton onClick={() => void send()} hasContent busy={sending} label={t("diff.comment.send")} className="mt-1 self-end" />
          )}
        </div>
      )}

      <FileDiffSheet
        cardId={cardId}
        file={open}
        remote={remote}
        onClose={() => setOpen(null)}
        comments={comments}
        onComment={onSend ? (c) => setComments((cs) => [...cs, c]) : undefined}
      />
    </Panel>
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
      <span className="text-destructive">{"−".repeat(Math.min(minus, width))}</span>
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
  remote,
  onClose,
  comments,
  onComment,
}: {
  cardId: string;
  file: DiffFile | null;
  remote: boolean;
  onClose: () => void;
  comments: readonly DiffComment[];
  onComment?: (c: DiffComment) => void;
}) {
  const t = useT();
  const [body, setBody] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The toggle remembers the FILE it was tapped on, not just a boolean: opening another file must
  // fall back to that file's own default, and a bare boolean reset in an effect would fetch once in
  // the stale mode before correcting itself.
  const [override, setOverride] = useState<{ path: string; prose: boolean } | null>(null);

  // A `.md` opens READ-FIRST — the point of tapping a report is to read it, and the patch is one tap
  // away. Every other file keeps exactly the diff it always had.
  const markdown = file !== null && !remote && isMarkdownPath(file.path);
  const prose = file !== null && (override?.path === file.path ? override.prose : markdown);
  // Indices of the tapped lines and the note being written for them.
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const lines = numberDiff(body);
  const commented = new Set(comments.filter((c) => c.path === file?.path).flatMap((c) => c.keys));

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBody("");
    setError(null);
    setSelected([]);
    setNote("");
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
        if (!cancelled) setError(boardErrorMessage(e));
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
          className="mb-2 flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-xs text-muted-foreground"
        >
          {prose ? <FileDiff className="size-3.5" /> : <BookOpen className="size-3.5" />}
          {prose ? t("diff.showDiff") : t("diff.readDoc")}
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
              <FileText className="size-4" /> {t("diff.emptyFile")}
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
            {lines.map((line, i) => (
              <div
                key={i}
                onClick={
                  onComment && line.code
                    ? () => setSelected((s) => (s.includes(i) ? s.filter((j) => j !== i) : [...s, i].sort((a, b) => a - b)))
                    : undefined
                }
                aria-selected={onComment && line.code ? selected.includes(i) : undefined}
                className={cn(
                  "whitespace-pre-wrap break-all border-l-2 border-transparent sm:whitespace-pre sm:break-normal",
                  lineClass(line.text),
                  onComment && line.code && "cursor-pointer",
                  line.code && commented.has(lineKey(line)) && "border-status-working",
                  selected.includes(i) && "bg-primary/15",
                )}
              >
                {line.text || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
      {onComment && !prose && !error && body !== "" && (
        selected.length === 0 ? (
          <p className="pt-2 text-xs text-muted-foreground">{t("diff.comment.hint")}</p>
        ) : (
          <div className="flex flex-col gap-2 pt-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              placeholder={t("diff.comment.placeholder")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-9 flex-1"
                disabled={note.trim() === ""}
                onClick={() => {
                  onComment(makeComment(file!.path, selected.map((i) => lines[i]!), note));
                  setSelected([]);
                  setNote("");
                }}
              >
                {t("diff.comment.add")}
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => { setSelected([]); setNote(""); }}>
                {t("diff.comment.cancel")}
              </Button>
            </div>
          </div>
        )
      )}
      {truncated && (
        <p className="pt-2 text-xs text-muted-foreground">
          {prose ? t("diff.truncatedFile") : t("diff.truncatedDiff")}
        </p>
      )}
      <Button variant="outline" onClick={onClose} className="mt-3 h-11 w-full">
        {t("diff.close")}
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
  if (line.startsWith("-")) return "text-destructive";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-muted-foreground";
  return "";
}
