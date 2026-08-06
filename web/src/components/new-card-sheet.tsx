import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, FolderGit2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useHoldReload } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { fetchRepos, normalizeTag, setRepoHidden, type CardInput, type RepoChoice } from "@/lib/board";
import { TagField } from "@/components/tag-field";
import { useLongPress } from "@/hooks/use-long-press";

interface NewCardSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CardInput) => void;
  /** The tags already in use, most recent first — the board derives it with `tagsOf`. */
  tags: string[];
  /**
   * The repo the board is currently scoped to, if any. Wins over "the most recently carded repo"
   * for the pre-selection — a scoped board has already said where you are working. Ignored when the
   * path isn't in the picker (hidden, or gone), which falls back to the usual first entry.
   */
  repoPath?: string | null;
}

// Create a card. The big field is deliberately a plain multi-line textarea: on Android that box IS
// the voice input (the keyboard's mic button dictates into it), which is the whole reason the brain
// dump is the primary field rather than a tidy form. Everything else is optional.
//
// The title is derived from the first line when you don't type one — dictating "add a diff view,
// scoped to the card's branch, must render --stat first" should produce a usable card with no extra
// taps. A real reformulation (title + spec + acceptance + branch name) is the copilot's job.
export function NewCardSheet({ open, onClose, onCreate, tags, repoPath: scope }: NewCardSheetProps) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [selected, setSelected] = useState<RepoChoice | null>(null);
  // Manual entry stays available — a repo the bridge can't know about (just cloned, on a mount it
  // has never seen) must not be a dead end.
  const [manual, setManual] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [baseRef, setBaseRef] = useState("");
  // Whether the dump goes in as rawInput (and so gets rewritten). Reset per open, deliberately: it
  // is a property of THIS card, not a preference — most cards are dictated and want the rewrite.
  const [rewrite, setRewrite] = useState(true);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showHidden, setShowHidden] = useState(false);

  // A self-update reload must not eat a half-dictated brain dump.
  useHoldReload("new-card", open);

  useEffect(() => {
    if (!open) return;
    setText("");
    setTag("");
    setRewrite(true);
    setManual(false);
    setManualPath("");
    let cancelled = false;
    setShowHidden(false);
    void fetchRepos()
      .then(({ repos: list, hiddenCount: n }) => {
        if (cancelled) return;
        setRepos(list);
        setHiddenCount(n);
        // Nothing found at all — no cards, an empty herd, nothing under the scan roots. Drop
        // straight into the text field rather than showing a lone "type a path instead" link and
        // making the user work out that the picker is empty on purpose.
        if (list.length === 0) {
          setManual(true);
          return;
        }
        // The board's scope if it has one, else the first entry — the most recently carded repo.
        // Either way the likely answer is pre-selected, so the common case is "dictate, tap Add".
        const first = (scope && list.find((r) => r.path === scope)) || list[0]!;
        setSelected(first);
        setBaseRef(first.defaultBranch ?? "");
      })
      .catch(() => {
        // The bridge couldn't answer. Not a blocker: fall through to typing a path.
        if (!cancelled) setManual(true);
      });
    return () => {
      cancelled = true;
    };
    // `scope` can only change while the sheet is CLOSED (the strip is behind it), where this
    // early-returns — listing it just keeps the closure honest.
  }, [open, scope]);

  function pick(repo: RepoChoice) {
    setSelected(repo);
    setManual(false);
    setBaseRef(repo.defaultBranch ?? "");
  }

  /** Refetch after a hide/unhide so the list and the count stay honest. */
  async function reload(all: boolean) {
    const { repos: list, hiddenCount: n } = await fetchRepos({ all });
    setRepos(list);
    setHiddenCount(n);
    // The selection may have just been hidden out from under us.
    if (selected && !list.some((r) => r.path === selected.path && !r.hidden)) {
      const first = list.find((r) => !r.hidden) ?? null;
      setSelected(first);
      setBaseRef(first?.defaultBranch ?? "");
    }
  }

  async function toggleHidden(repo: RepoChoice) {
    await setRepoHidden(repo.path, !repo.hidden);
    await reload(showHidden);
  }

  async function toggleShowHidden() {
    const next = !showHidden;
    setShowHidden(next);
    await reload(next);
  }

  const title = deriveTitle(text);
  const repoPath = manual ? manualPath.trim() : (selected?.path ?? "");

  function create() {
    if (!title) return;
    onCreate({
      title,
      // `rawInput` IS the instruction to rewrite: creating a card with one is the only thing that
      // makes the copilot act unasked (bridge/board-routes.ts). Withholding it therefore needs no
      // flag of its own — it says exactly what "leave this card alone" means, and it says it in a
      // field the schema already defines as "a dump, to be processed".
      rawInput: rewrite ? text.trim() : null,
      // The spec is set either way, so the card is usable before the copilot ever runs — and, when
      // it is off, IS the text, which is what makes a hand-written card survive intact.
      spec: text.trim(),
      status: "backlog",
      repoPath: repoPath || null,
      baseRef: baseRef.trim() || null,
      // Optional, and null is the normal answer — most cards have no tag. Normalised here so the
      // card lands as the tag the field was showing you; the bridge folds it again regardless.
      tag: normalizeTag(tag),
    });
    onClose();
  }

  return (
    // The confirm action is PINNED below the scroller, not the last thing in it: this form is taller
    // than the sheet on a phone, so a button at the end of the body opens below the fold and has to
    // be scrolled to. The derived title rides with it — it is the preview of what the tap creates.
    <BottomSheet
      open={open}
      onClose={onClose}
      title="New card"
      footer={
        <div className="flex flex-col gap-1">
          {title && (
            <p className="truncate px-1 text-xs text-muted-foreground">
              Titre déduit : <span className="text-foreground">{title}</span>
            </p>
          )}
          <Button
            variant="brand"
            onClick={create}
            disabled={!title}
            className="h-12 w-full rounded-xl text-sm font-semibold"
          >
            Ajouter au backlog
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            What needs doing (dictate away)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Add a diff view scoped to the card&apos;s branch…"
            className="rounded-lg border border-brand/35 bg-background px-3 py-2 text-[15px] leading-[1.5] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        {/* On by default: a dictated brain dump is what this box is for, and rewriting it is the
            whole point. Off is for the card you have already worded exactly — and it is the only
            control that matters, because creating a card is the ONLY moment the copilot rewrites
            anything without being asked. Every later run is a button, and now a confirmed one. */}
        <div className="flex items-center justify-between gap-3 px-1 py-1">
          <span className="text-xs text-muted-foreground">Le copilote va réécrire ce texte</span>
          <Switch checked={rewrite} onCheckedChange={setRewrite} aria-label="Rewrite with the copilot" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Repo{repos.length > 4 && " · long-press to hide one"}
          </span>
          {repos.length > 0 && (
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
              {repos.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  active={!manual && selected?.path === repo.path}
                  onPick={() => pick(repo)}
                  onToggleHidden={() => void toggleHidden(repo)}
                />
              ))}
            </div>
          )}

          {(hiddenCount > 0 || showHidden) && (
            <button
              type="button"
              onClick={() => void toggleShowHidden()}
              className="flex items-center gap-1.5 self-start px-1 py-1 text-xs text-muted-foreground underline underline-offset-4"
            >
              {showHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {showHidden ? "Hide them again" : `${hiddenCount} hidden — show`}
            </button>
          )}

          {manual ? (
            <>
              {repos.length === 0 && (
                <p className="pb-1 text-xs text-muted-foreground">
                  No repos found yet — none carded, none open in the herd. Type a path; the next card
                  will offer it back.
                </p>
              )}
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/home/you/code/project"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setManual(true)}
              className="flex items-center gap-1.5 self-start px-1 py-1 text-xs text-muted-foreground underline underline-offset-4"
            >
              <Pencil className="size-3" />
              Type a path instead
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Base ref{selected?.defaultBranch && " (from the repo)"}
          </span>
          <input
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder="main"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <TagField value={tag} onChange={setTag} tags={tags} />
      </div>
    </BottomSheet>
  );
}

/**
 * One repo in the picker. Tap selects; LONG-PRESS hides it — the same gesture the pane switcher
 * already uses for per-item actions, so it needs no explaining, and unlike a per-row ✕ it cannot be
 * mistapped while scrolling a list of thirty.
 *
 * Hiding is the one thing about a repo the board stores, because it is the one thing it cannot
 * derive: a scan that finds every repo you own has no idea which three you actually card.
 */
function RepoRow({
  repo,
  active,
  onPick,
  onToggleHidden,
}: {
  repo: RepoChoice;
  active: boolean;
  onPick: () => void;
  onToggleHidden: () => void;
}) {
  const longPress = useLongPress(onToggleHidden);
  return (
    <button
      type="button"
      onClick={onPick}
      {...longPress}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left active:scale-[0.99]",
        active ? "border-primary bg-primary/10" : "border-border bg-background",
        repo.hidden && "opacity-50",
      )}
    >
      <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{repo.name}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{repo.path}</span>
      </span>
      {repo.hidden ? (
        <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        repo.source === "herd" && (
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
            open
          </span>
        )
      )}
      {active && !repo.hidden && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

/**
 * A card title from a free-text dump: its first non-empty line, trimmed of list/heading markers and
 * clipped to something that fits a tile. Exported for the unit test — the interesting cases are a
 * dump that starts with a bullet, and one that is a single long paragraph with no line breaks.
 */
export function deriveTitle(text: string, max = 72): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!line) return "";
  const cleaned = line.replace(/^[-*#>\s]+/, "").trim();
  if (cleaned.length <= max) return cleaned;
  // Prefer a word boundary so a clipped title doesn't end mid-word.
  const clipped = cleaned.slice(0, max);
  const space = clipped.lastIndexOf(" ");
  return `${(space > max * 0.6 ? clipped.slice(0, space) : clipped).trimEnd()}…`;
}
