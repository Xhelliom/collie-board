import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { RepoMenu, type PickItem } from "@/components/repo-picker";
import { useHoldReload } from "@/lib/reload-guard";
import { fetchRepos, type RepoChoice } from "@/lib/board";
import { shortCwd } from "@/lib/format";
import { useT } from "@/i18n";

interface NewSpaceSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: { label?: string; cwd?: string }) => void;
  title?: string;
  /** The project you came from (its repo name): picked first when the board knows it. */
  project?: string;
}

const OTHER = "\0other";

// A new space (workspace) with a fresh shell you launch your agent in — under herdr 0.9 as under hc.
// The folder is one of the repos the board knows (fetched on opening: `/api/repos` shells out, never
// on the poll), your home dir, or « Autre dossier… », which brings the free path back.
export function NewSpaceSheet({ open, onClose, onCreate, title, project }: NewSpaceSheetProps) {
  const t = useT();
  const dirLabel = useId();
  const [label, setLabel] = useState("");
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [choice, setChoice] = useState("");
  const [cwd, setCwd] = useState("");
  const [picking, setPicking] = useState(false);
  const stopPicking = useCallback(() => setPicking(false), []);

  // Don't let a self-update reload yank this tab/space form out from under a half-typed
  // directory/label — hold while it's open; the self-updater shows the banner and updates on close.
  useHoldReload("new-space", open);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setCwd("");
    setChoice("");
    setPicking(false);
    const ac = new AbortController();
    fetchRepos({}, ac.signal).then(
      (r) => {
        setRepos(r.repos);
        const mine = project && r.repos.find((x) => x.name === project);
        if (mine) setChoice((c) => c || mine.path);
      },
      () => {},
    );
    return () => ac.abort();
  }, [open, project]);

  function create() {
    const dir = choice === OTHER ? cwd.trim() : choice;
    onCreate({ label: label.trim() || undefined, cwd: dir || undefined });
    onClose();
  }

  const items: PickItem[] = [
    { value: "", label: t("agents.newSheet.home") },
    ...repos.map((r) => ({ value: r.path, label: `${r.name} — ${shortCwd(r.path)}` })),
    { value: OTHER, label: t("agents.newSheet.other"), action: true },
  ];
  const picked = items.find((i) => i.value === choice)?.label ?? shortCwd(choice);
  const field = "h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <BottomSheet open={open} onClose={onClose} title={title ?? t("spaces.new")}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span id={dirLabel} className="text-xs font-medium text-muted-foreground">{t("spaces.newSheet.dir")}</span>
          <RepoMenu
            open={picking}
            onClose={stopPicking}
            items={items}
            current={choice}
            onPick={(v) => {
              setChoice(v);
              setPicking(false);
            }}
            title={t("spaces.newSheet.dir")}
            panelClassName="w-full"
          >
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={picking}
              aria-labelledby={`${dirLabel} ${dirLabel}-v`}
              onClick={() => setPicking((o) => !o)}
              className={`${field} flex w-full cursor-pointer items-center gap-2 text-left`}
            >
              <span id={`${dirLabel}-v`} className="min-w-0 flex-1 truncate">{picked}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </RepoMenu>
        </div>
        {choice === OTHER && (
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder={t("spaces.newSheet.dirPlaceholder")}
            aria-label={t("agents.newSheet.path")}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${field} font-mono`}
          />
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("spaces.newSheet.label")}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("spaces.newSheet.labelPlaceholder")}
            className={field}
          />
        </label>
        <Button onClick={create} className="mt-1 h-11">
          {t("spaces.newSheet.create")}
        </Button>
      </div>
    </BottomSheet>
  );
}
