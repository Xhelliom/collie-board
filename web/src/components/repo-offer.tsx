import { useCallback, useEffect, useState } from "react";

import { useT } from "@/i18n";
import { AGENT_KIND_LABEL, AGENT_KIND_OPTIONS } from "@/components/agent-kind-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { boardErrorMessage, repoName } from "@/lib/board";
import { addEnvironment, fetchPeers, grantLaunch, removeEnvironment, renameEnvironment, setEnvironmentAgent, type PeersView } from "@/lib/peers";

const field = "rounded-md border bg-background px-3 py-2 text-sm";

// Project settings → « Exécution depuis un autre poste »: this repo offered to the paired peers, as an
// environment of node.toml (ADR 0049 §6), and who may launch in it (ADR 0051). Same /api/peers/* calls
// as Settings → Peers — the operator's own; the bridge refuses them from an agent's pane.
export function RepoOffer({ repo }: { repo: string }) {
  const t = useT();
  const [view, setView] = useState<PeersView | null>(null);
  const [agent, setAgent] = useState<string>(AGENT_KIND_OPTIONS[0]);
  const [name, setName] = useState(repoName(repo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchPeers().then(
        (v) => setView(v),
        (e) => setError(boardErrorMessage(e)),
      ),
    [],
  );
  useEffect(() => void load(), [load]);

  const env = view?.environments.find((e) => e.repoPath === repo) ?? null;
  // Follow the stored environment once read; before an offer, the repo's name and the first agent.
  useEffect(() => {
    setName(env?.name ?? repoName(repo));
    if (env) setAgent(env.agent);
  }, [env?.name, env?.agent, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(false);
      void load();
    }
  }

  if (!view) return error ? <p className="text-sm text-destructive">{error}</p> : null;
  return (
    <Card className="gap-3 p-4" role="region" aria-label={t("repoOffer.title")}>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-medium">{t("repoOffer.toggle")}</span>
          <span className="block text-sm text-muted-foreground">{t("repoOffer.hint")}</span>
        </span>
        <Switch
          aria-label={t("repoOffer.toggle")}
          checked={Boolean(env)}
          disabled={busy || !name}
          onCheckedChange={(on) => void run(() => (on ? addEnvironment(name, repo, agent) : removeEnvironment(env!.name)))}
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <label className="flex flex-col gap-1 text-sm">
        {t("peers.env.agent")}
        <select
          value={agent}
          disabled={busy}
          onChange={(e) => {
            setAgent(e.target.value);
            if (env) void run(() => setEnvironmentAgent(env.name, e.target.value));
          }}
          className={field}
        >
          {AGENT_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {AGENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <form
        className="flex flex-col gap-1 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (env && name !== env.name) void run(() => renameEnvironment(env.name, name));
        }}
      >
        <label htmlFor="repo-offer-name">{t("repoOffer.name")}</label>
        <div className="flex gap-2">
          <input id="repo-offer-name" required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={`${field} min-w-0 flex-1`} />
          {env && name !== env.name && (
            <Button type="submit" size="sm" disabled={busy}>
              {t("peers.env.save")}
            </Button>
          )}
        </div>
      </form>
      {view.inbound.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("repoOffer.noPeer")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {view.inbound.map((p) => {
            // `launch` null: a hand-written peer, every environment (bridge/node.ts).
            const granted = Boolean(env) && (p.launch === null || p.launch.includes(env!.name));
            return (
              <li key={p.name}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={granted}
                    disabled={busy || !env}
                    onChange={() => void run(() => grantLaunch(p.name, env!.name, !granted))}
                  />
                  {t("repoOffer.allow", { peer: p.name })}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
