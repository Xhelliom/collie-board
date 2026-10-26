import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { boardErrorMessage, fetchRepoShare, setRepoShare, type RepoShare } from "@/lib/board";
import { setStatus } from "@/lib/status";

// Sharing a repo's board over git (ADR 0048 §1, §6). Off by default; turning it on or off is the
// operator's gesture — the bridge refuses it to an agent pane — and what it costs is said BEFORE the
// confirm: a backup, a merge with a board already on the remote, edits lost on a re-activation, the
// changes that will not go. The remote branch is only signalled here, never acted on.
export function ShareSettings({ repo }: { repo: string }) {
  const t = useT();
  const [info, setInfo] = useState<RepoShare | null>(null);
  // The remote the operator picked; the one shown is what the bridge answered for it (`info.remote`).
  const [picked, setPicked] = useState<string | undefined>();
  const [asking, setAsking] = useState<"on" | "off" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchRepoShare(repo, picked, ac.signal)
      .then(setInfo)
      .catch(() => {});
    return () => ac.abort();
  }, [repo, picked]);

  if (!info) return null;
  const shared = info.share !== null;
  const remote = info.remote;

  async function apply() {
    setBusy(true);
    try {
      await setRepoShare(repo, asking === "on" ? remote : null);
      setStatus(asking === "on" ? t("project.share.done", { remote: remote ?? "" }) : t("project.share.stopped"), "success", 2500);
      setInfo(await fetchRepoShare(repo, picked));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  const sync = info.sync;
  const state = !sync
    ? null
    : sync.readOnly
      ? t("project.share.readOnly", { reason: sync.readOnly })
      : sync.offline
        ? `${t("project.share.offline")} · ${t("project.share.unsent", { count: sync.unsent })}`
        : sync.unsent > 0
          ? t("project.share.unsent", { count: sync.unsent })
          : t("project.share.upToDate");

  return (
    <section aria-label={t("project.share.fold")} className="rounded-2xl border bg-card/40 p-3.5 text-sm">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className={info.remotes.length === 0 ? "opacity-50" : undefined}>{t("project.share.on")}</span>
          <Switch
            checked={shared}
            disabled={busy || asking !== null || (!shared && !remote)}
            onCheckedChange={(on) => setAsking(on ? "on" : "off")}
            aria-label={t("project.share.on")}
          />
        </div>
        {info.remotes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("project.share.noRemote")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("project.share.hint", { remote: info.share ?? remote ?? "" })}</p>
        )}
        {!shared && info.remotes.length > 1 && (
          <label className="flex items-center justify-between gap-3">
            <span>{t("project.share.remote")}</span>
            <select
              value={remote ?? ""}
              disabled={asking !== null}
              onChange={(e) => setPicked(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              {info.remotes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
        {!shared && info.branch && <p className="text-xs">{t("project.share.branch", { remote: remote ?? "" })}</p>}
        {state && <p role="status" className="text-xs">{state}</p>}
        {info.identity && (shared || asking === "on") && (
          <p className="text-xs text-muted-foreground">{t("project.share.identity", { identity: info.identity })}</p>
        )}
        {asking && (
          <div role="alertdialog" aria-label={t("project.share.on")} className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {asking === "on" ? (
              <>
                <p>{t("project.share.askOn")}</p>
                {info.branch && <p>{t("project.share.askMerge")}</p>}
                {info.wasShared && <p className="font-medium">{t("project.share.askReactivate")}</p>}
              </>
            ) : (
              <>
                <p className="font-medium">{t("project.share.askOff", { count: sync?.unsent ?? 0 })}</p>
                <p>{t("project.share.askOffBranch")}</p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className="rounded-full border px-3 py-1.5">
                {t("project.share.cancel")}
              </button>
              <button type="button" disabled={busy} onClick={() => void apply()} className="rounded-full bg-primary px-3 py-1.5 text-primary-foreground">
                {t("project.share.confirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
