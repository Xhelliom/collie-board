import { useEffect, useState } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { GateSheet } from "@/components/gate-sheet";
import { Card } from "@/components/ui/card";
import { fetchRepos, repoName, type RepoChoice } from "@/lib/board";

// Settings: each repo's gate (ADR 0020) at a glance, one tap to set it. The list is the new-card
// picker's — a repo you have carded or have open — so a repo with no gate says so right where you
// would otherwise start a run on it. Renders nothing until the bridge answers, and nothing if it
// never does.
export function GateControl() {
  const [repos, setRepos] = useState<RepoChoice[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setRepos(r.repos))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  if (!repos || repos.length === 0) return null;
  const current = repos.find((r) => r.path === editing);

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-4 pb-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="font-medium">Barrière par dépôt</div>
          <p className="text-sm text-muted-foreground">
            La commande lancée sur chaque retour de worker avant le lead, pendant un run.
          </p>
        </div>
      </div>
      <ul className="divide-y">
        {repos.map((r) => (
          <li key={r.path}>
            <button
              type="button"
              onClick={() => setEditing(r.path)}
              className="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{repoName(r.path)}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{r.gate ?? "aucune"}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <GateSheet
          open
          onClose={() => setEditing(null)}
          repoPath={editing}
          gate={current?.gate ?? null}
          onSaved={(gate) =>
            setRepos((rs) => rs?.map((r) => (r.path === editing ? { ...r, gate: gate ?? undefined } : r)) ?? rs)
          }
        />
      )}
    </Card>
  );
}
