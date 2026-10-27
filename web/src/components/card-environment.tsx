import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { endCardRemote, fetchCardRemote, fetchRepoEnvironments, patchCard, type CardEnvironment as Env, type CardRemote, type CardView } from "@/lib/board";

const keyOf = (e: Env | null | undefined) => (e ? `${e.peer}/${e.name}` : "");

// Where the card runs (ADR 0046 §4): this machine, or a paired peer's environment whose origin is
// this repo's. Both reads happen when the card is opened, never on a timer — the peer's live state
// is lot 2's (the unified herd); this only says what it was a moment ago.
export function CardEnvironment({ card, onChanged, onError }: { card: CardView; onChanged: () => void; onError: (m: string) => void }) {
  const t = useT();
  const [envs, setEnvs] = useState<Awaited<ReturnType<typeof fetchRepoEnvironments>> | null>(null);
  const [remote, setRemote] = useState<CardRemote | null>(null);
  const [ending, setEnding] = useState(false);
  const env = card.environment ?? null;
  const envKey = keyOf(env);

  useEffect(() => {
    if (!card.repoPath) return;
    fetchRepoEnvironments(card.repoPath).then(setEnvs, () => setEnvs(null));
  }, [card.repoPath]);
  // Re-read when the card's start or end changes its journal, i.e. when its status moves.
  useEffect(() => {
    if (!envKey) return setRemote(null);
    fetchCardRemote(card.id).then(setRemote, () => setRemote(null));
  }, [card.id, envKey, card.status]);

  const session = remote?.session ?? null;
  if (session) {
    const st = remote?.state;
    const state = !st?.reachable
      ? t("cardEnv.unreachable", { error: st?.error ?? "" })
      : st.pane
        ? t("cardEnv.pane", { status: st.pane.status })
        : t("cardEnv.paneGone");
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="card-remote">
        <p className="text-sm">{t("cardEnv.runningOn", { peer: session.peer, environment: session.environment, branch: session.branch })}</p>
        <p className="text-xs text-muted-foreground">{state}</p>
        <Button
          variant="outline"
          disabled={ending}
          onClick={async () => {
            setEnding(true);
            try {
              await endCardRemote(card.id);
              setRemote(await fetchCardRemote(card.id));
            } catch (e) {
              onError((e as Error).message);
            }
            setEnding(false);
            onChanged();
          }}
        >
          {t("cardEnv.end", { peer: session.peer })}
        </Button>
      </div>
    );
  }

  const offered = envs?.environments ?? [];
  // Nothing to choose between, and nothing chosen: no peer runs this repo — say nothing.
  if (offered.length === 0 && !env) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("cardEnv.label")}</span>
      <select
        aria-label={t("cardEnv.label")}
        value={keyOf(env)}
        onChange={async (e) => {
          const picked = offered.find((o) => keyOf(o) === e.target.value) ?? null;
          try {
            await patchCard(card.id, { environment: picked ? { peer: picked.peer, name: picked.name } : null });
          } catch (err) {
            onError((err as Error).message);
          }
          onChanged();
        }}
        className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">{t("cardEnv.local")}</option>
        {offered.map((o) => (
          <option key={keyOf(o)} value={keyOf(o)}>
            {t("cardEnv.option", { name: o.name, peer: o.peer, agent: o.agent })}
          </option>
        ))}
        {env && !offered.some((o) => keyOf(o) === keyOf(env)) && <option value={keyOf(env)}>{t("cardEnv.option", { name: env.name, peer: env.peer, agent: "?" })}</option>}
      </select>
      <p className="px-1 text-xs text-muted-foreground">
        {t("cardEnv.hint")}
        {envs?.unreachable.length ? ` ${t("cardEnv.someUnreachable", { peers: envs.unreachable.map((u) => u.peer).join(", ") })}` : ""}
      </p>
    </label>
  );
}
