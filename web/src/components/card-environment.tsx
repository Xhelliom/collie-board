import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { endCardRemote, fetchCardRemote, fetchRepoEnvironments, patchCard, type CardEnvironment as Env, type CardRemote, type CardView } from "@/lib/board";

const keyOf = (e: Env | null | undefined) => (e ? `${e.peer}/${e.name}` : "");

// Where the card runs (ADR 0046 §4): this machine, or a paired peer's environment whose origin is
// this repo's. Both reads happen when the card is opened, never on a timer — the peer's live state
// is lot 2's (the unified herd); this only says what it was a moment ago.
// `children` (the Start button) shows only once the card is known not to run on a peer: the bridge
// would refuse a second launch ("already running on …"), and a button that can only fail is a wasted tap.
export function CardEnvironment({ card, onChanged, onError, children }: { card: CardView; onChanged: () => void; onError: (m: string) => void; children?: ReactNode }) {
  const t = useT();
  // undefined: not read yet — Start waits for the answer rather than flash in and out.
  const [remote, setRemote] = useState<CardRemote | null | undefined>(card.environment ? undefined : null);
  const [ending, setEnding] = useState(false);
  const env = card.environment ?? null;
  const envKey = keyOf(env);

  // Re-read when the card's start or end changes its journal, i.e. when its status moves.
  useEffect(() => {
    if (!envKey) return setRemote(null);
    let live = true;
    fetchCardRemote(card.id).then(
      (r) => live && setRemote(r),
      () => live && setRemote(null),
    );
    return () => {
      live = false;
    };
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

  if (remote === undefined) return null;
  if (!card.repoPath) return children;
  return (
    <>
      <EnvironmentPicker
        repoPath={card.repoPath}
        value={env}
        // A local session whose pane is gone still holds the card here: the bridge refuses the move.
        lockedReason={card.session ? t("cardEnv.locked") : undefined}
        onChange={async (picked) => {
          try {
            await patchCard(card.id, { environment: picked });
          } catch (err) {
            onError((err as Error).message);
          }
          onChanged();
        }}
      />
      {children}
    </>
  );
}

/**
 * « Lancer sur »: this machine, then the peers' environments whose origin is this repo's; an
 * unreachable peer stays listed, greyed with its reason. No peer at all: no picker — nothing changes.
 * Read when it mounts, never polled.
 */
export function EnvironmentPicker({
  repoPath,
  value,
  onChange,
  lockedReason,
}: {
  repoPath: string;
  value: Env | null;
  onChange: (e: Env | null) => void;
  /** Set while a session runs: the picker shows where it runs, and why it can't move. */
  lockedReason?: string;
}) {
  const t = useT();
  const [envs, setEnvs] = useState<Awaited<ReturnType<typeof fetchRepoEnvironments>> | null>(null);
  useEffect(() => {
    let live = true;
    fetchRepoEnvironments(repoPath).then(
      (r) => live && setEnvs(r),
      () => live && setEnvs(null),
    );
    return () => {
      live = false;
    };
  }, [repoPath]);

  const offered = envs?.environments ?? [];
  const unreachable = envs?.unreachable ?? [];
  if (offered.length === 0 && unreachable.length === 0 && !value) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("cardEnv.label")}</span>
      <select
        aria-label={t("cardEnv.label")}
        value={keyOf(value)}
        disabled={Boolean(lockedReason)}
        onChange={(e) => {
          const picked = offered.find((o) => keyOf(o) === e.target.value);
          onChange(picked ? { peer: picked.peer, name: picked.name } : null);
        }}
        className="h-11 rounded-lg border border-border bg-background px-3 text-base outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <option value="">{t("cardEnv.local")}</option>
        {offered.map((o) => (
          <option key={keyOf(o)} value={keyOf(o)}>
            {t("cardEnv.option", { name: o.name, peer: o.peer })}
          </option>
        ))}
        {value && !offered.some((o) => keyOf(o) === keyOf(value)) && (
          <option value={keyOf(value)}>{t("cardEnv.option", { name: value.name, peer: value.peer })}</option>
        )}
        {unreachable.map((u) => (
          <option key={`!${u.peer}`} value={`!${u.peer}`} disabled>
            {t("cardEnv.unreachableOption", { peer: u.peer, error: u.error })}
          </option>
        ))}
      </select>
      <p className="px-1 text-xs text-muted-foreground">{lockedReason ?? t("cardEnv.hint")}</p>
    </label>
  );
}
