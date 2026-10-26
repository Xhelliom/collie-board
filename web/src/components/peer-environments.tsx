import { useEffect, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";

import { useT } from "@/i18n";
import { AGENT_KIND_LABEL, AGENT_KIND_OPTIONS } from "@/components/agent-kind-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { boardErrorMessage, fetchRepos, type RepoChoice } from "@/lib/board";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { addEnvironment, removeEnvironment, renameEnvironment, type PeersView } from "@/lib/peers";

const field = "rounded-md border bg-background px-3 py-2";

// Settings → Peers → Environments (ADR 0049 §6): a repo picked among the board's known ones and an
// agent, never a typed path — the bridge checks the repo against its own list before writing node.toml.
export function PeerEnvironments({ environments, onChange }: { environments: PeersView["environments"]; onChange: () => void }) {
  const t = useT();
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [repo, setRepo] = useState("");
  const [agent, setAgent] = useState<string>(AGENT_KIND_OPTIONS[0]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pending, confirm } = usePendingConfirm(4000);

  useEffect(() => {
    const ctl = new AbortController();
    fetchRepos({}, ctl.signal)
      .then((r) => setRepos(r.repos))
      .catch((e) => !ctl.signal.aborted && setError(boardErrorMessage(e)));
    return () => ctl.abort();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(boardErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
      onChange();
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => addEnvironment(name, repo, agent)).then((ok) => ok && (setName(""), setRepo("")));
  };

  return (
    <Card className="gap-3 p-4" aria-label={t("peers.env.title")} role="region">
      <div className="flex items-start gap-3">
        <Boxes className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="font-medium">{t("peers.env.title")}</div>
          <p className="text-sm text-muted-foreground">{t("peers.env.hint")}</p>
        </div>
      </div>
      {error && <p className="text-sm text-status-blocked">{error}</p>}
      {environments.length === 0 && <p className="text-sm text-muted-foreground">{t("peers.none")}</p>}
      <ul className="flex flex-col divide-y">
        {environments.map((env) => (
          <li key={env.name} className="flex flex-col gap-1.5 py-2">
            {editing?.from === env.name ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => renameEnvironment(env.name, editing.to)).then((ok) => ok && setEditing(null));
                }}
              >
                <input
                  aria-label={t("peers.env.name")}
                  required
                  autoFocus
                  value={editing.to}
                  onChange={(e) => setEditing({ ...editing, to: e.target.value })}
                  className={`${field} min-w-0 flex-1`}
                />
                <Button type="submit" size="sm" disabled={busy}>
                  {t("peers.env.save")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                  {t("peers.env.cancel")}
                </Button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{env.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {env.repoPath} · {AGENT_KIND_LABEL[env.agent as keyof typeof AGENT_KIND_LABEL] ?? env.agent}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing({ from: env.name, to: env.name })}>
                    {t("peers.env.rename")}
                  </Button>
                  <Button
                    variant={pending === `remove:${env.name}` ? "destructive" : "outline"}
                    size="sm"
                    disabled={busy}
                    onClick={() => confirm(`remove:${env.name}`) && void run(() => removeEnvironment(env.name))}
                  >
                    {pending === `remove:${env.name}` ? t("peers.confirm") : t("peers.env.remove")}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("peers.env.repo")}
          <select
            required
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              // The repo's name is the natural default; the operator may change it.
              if (!name) setName(repos.find((r) => r.path === e.target.value)?.name ?? "");
            }}
            className={field}
          >
            <option value="" disabled>
              {t("peers.env.pickRepo")}
            </option>
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name} — {r.path}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("peers.env.agent")}
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className={field}>
            {AGENT_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {AGENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("peers.env.name")}
          <input required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <Button type="submit" className="self-start" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {t("peers.env.add")}
        </Button>
      </form>
    </Card>
  );
}
