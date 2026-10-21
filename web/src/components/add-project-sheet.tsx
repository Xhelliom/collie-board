import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, fetchRepos, projectPath, saveRepoScope, type RepoChoice } from "@/lib/board";
import { setRepoListed } from "@/lib/listed-repos";

// "Ajouter un projet": a repo the bridge knows (herd, scan) or an absolute path typed by hand goes into
// the project lists (`repo_pref.listed`) and its project page opens. The list is fetched on opening —
// `/api/repos` shells out, so never on the poll.
export function AddProjectSheet({ open, onClose, exclude }: { open: boolean; onClose: () => void; exclude: readonly string[] }) {
  const t = useT();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    const ac = new AbortController();
    fetchRepos({}, ac.signal).then((r) => setRepos(r.repos), () => {});
    return () => ac.abort();
  }, [open]);

  async function add(path: string) {
    setBusy(true);
    setError(null);
    try {
      await setRepoListed(path, true);
      saveRepoScope(path);
      onClose();
      void navigate(projectPath(path));
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const offered = repos.filter((r) => !r.listed && !exclude.includes(r.path) && (!q || r.path.toLowerCase().includes(q)));
  const typedPath = query.trim().startsWith("/") ? query.trim() : null;

  return (
    <BottomSheet open={open} onClose={onClose} title={t("project.add.title")}>
      <div className="flex flex-col gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("project.add.placeholder")}
          aria-label={t("project.add.placeholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {typedPath && !offered.some((r) => r.path === typedPath) && (
          <Button variant="brand" disabled={busy} onClick={() => void add(typedPath)}>
            {t("project.add.path", { path: typedPath })}
          </Button>
        )}
        <ul className="flex flex-col gap-0.5">
          {offered.map((r) => (
            <li key={r.path}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(r.path)}
                className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-muted/60"
              >
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="truncate text-xs text-muted-foreground">{r.path}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
