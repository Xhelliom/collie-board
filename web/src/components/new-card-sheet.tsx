import { useEffect, useState } from "react";
import { Check, FolderGit2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useHoldReload } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { fetchRepos, type CardInput, type RepoChoice } from "@/lib/board";

interface NewCardSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CardInput) => void;
}

// Create a card. The big field is deliberately a plain multi-line textarea: on Android that box IS
// the voice input (the keyboard's mic button dictates into it), which is the whole reason the brain
// dump is the primary field rather than a tidy form. Everything else is optional.
//
// The title is derived from the first line when you don't type one — dictating "add a diff view,
// scoped to the card's branch, must render --stat first" should produce a usable card with no extra
// taps. A real reformulation (title + spec + acceptance + branch name) is the copilot's job.
export function NewCardSheet({ open, onClose, onCreate }: NewCardSheetProps) {
  const [text, setText] = useState("");
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [selected, setSelected] = useState<RepoChoice | null>(null);
  // Manual entry stays available — a repo the bridge can't know about (just cloned, on a mount it
  // has never seen) must not be a dead end.
  const [manual, setManual] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [baseRef, setBaseRef] = useState("");

  // A self-update reload must not eat a half-dictated brain dump.
  useHoldReload("new-card", open);

  useEffect(() => {
    if (!open) return;
    setText("");
    setManual(false);
    setManualPath("");
    let cancelled = false;
    void fetchRepos()
      .then(({ repos: list }) => {
        if (cancelled) return;
        setRepos(list);
        // The first entry is the most recently carded repo — the likely answer, pre-selected so the
        // common case is "dictate, tap Add".
        const first = list[0] ?? null;
        setSelected(first);
        setBaseRef(first?.defaultBranch ?? "");
      })
      .catch(() => {
        // No list is not a blocker: fall straight through to typing a path.
        if (!cancelled) setManual(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function pick(repo: RepoChoice) {
    setSelected(repo);
    setManual(false);
    setBaseRef(repo.defaultBranch ?? "");
  }

  const title = deriveTitle(text);
  const repoPath = manual ? manualPath.trim() : (selected?.path ?? "");

  function create() {
    if (!title) return;
    onCreate({
      title,
      rawInput: text.trim(),
      // Keep the dump as the spec too, so a card is usable before the copilot ever runs.
      spec: text.trim(),
      status: "backlog",
      repoPath: repoPath || null,
      baseRef: baseRef.trim() || null,
    });
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="New card">
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
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Repo</span>
          {repos.length > 0 && (
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
              {repos.map((repo) => {
                const active = !manual && selected?.path === repo.path;
                return (
                  <button
                    key={repo.path}
                    type="button"
                    onClick={() => pick(repo)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left active:scale-[0.99]",
                      active ? "border-primary bg-primary/10" : "border-border bg-background",
                    )}
                  >
                    <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{repo.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {repo.path}
                      </span>
                    </span>
                    {repo.source === "herd" && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        open
                      </span>
                    )}
                    {active && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          {manual ? (
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/home/you/code/project"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
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

        {title && (
          <p className="truncate text-xs text-muted-foreground">
            Title: <span className="text-foreground">{title}</span>
          </p>
        )}
        <Button onClick={create} disabled={!title} className="mt-1 h-11">
          Add to backlog
        </Button>
      </div>
    </BottomSheet>
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
