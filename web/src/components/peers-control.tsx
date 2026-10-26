import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Network } from "lucide-react";

import { useLocale, useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { boardErrorMessage } from "@/lib/board";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { PeerEnvironments } from "@/components/peer-environments";
import {
  addPeer,
  cancelInvite,
  fetchPeers,
  forgetPeer,
  formatCode,
  invitePeer,
  revokePeer,
  testPeer,
  type PeersView,
  type TestResult,
} from "@/lib/peers";

// Settings → Peers (ADR 0049). « Inviter » on the machine to be driven shows a single-use code;
// « Ajouter » on the driving one sends the other's address and that code to ITS OWN bridge, which
// pairs server to server. This screen never sees a token: names, logins, dates, outcomes.
// While an invitation is open the view is refetched every few seconds, so the screen notices the
// other machine using (or burning) it — a screen timer, not a bridge loop.
export function PeersControl() {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<PeersView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ name: string; test: TestResult } | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const { pending, confirm } = usePendingConfirm(4000);

  const load = useCallback(() => {
    fetchPeers()
      .then((v) => setView(v))
      .catch((e) => setError(boardErrorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const open = view?.invitation?.state === "open" ? view.invitation : null;
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= open.expiresAt) load();
    }, 1000);
    const refresh = setInterval(load, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [open, load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  const invite = () =>
    run(async () => {
      await invitePeer();
      setNow(Date.now());
    });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setAdded(null);
    void run(async () => {
      const r = await addPeer(url, code);
      setAdded({ name: r.peer.name, test: r.test });
      setCode("");
    });
  };

  const date = (iso: string | number | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "");
  const testText = (r: TestResult) =>
    r.state === "ok"
      ? [
          t("peers.test.ok", { node: r.node, count: r.environments.length }) + (r.environments.length ? ` (${r.environments.map((e) => e.name).join(", ")})` : ""),
          r.version && t("peers.test.version", { version: r.version }),
          r.panes === null ? t("peers.test.herdrDown") : t("peers.test.panes", { count: r.panes }),
          r.seenAs && t("peers.test.seenAs", { peer: r.seenAs.peer, login: r.seenAs.login ?? t("peers.noLogin") }),
        ]
          .filter(Boolean)
          .join(" · ")
      : r.state === "unreachable"
        ? t("peers.test.unreachable", { error: r.error })
        : t(`peers.test.${r.state}`);

  if (!view) return error ? <p className="text-sm text-status-blocked">{error}</p> : <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  const left = open ? Math.max(0, Math.ceil((open.expiresAt - now) / 1000)) : 0;
  const inv = view.invitation;

  return (
    <>
      <Card className="gap-2 p-4">
        <div className="flex items-start gap-3">
          <Network className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">{t("peers.title")}</div>
            <p className="text-sm text-muted-foreground">{t("peers.hint", { name: view.name })}</p>
            <p className="text-xs text-muted-foreground">{t("peers.rewrite")}</p>
          </div>
        </div>
        {(error ?? view.error) && <p className="text-sm text-status-blocked">{error ?? view.error}</p>}
      </Card>

      <Card className="gap-3 p-4" aria-label={t("peers.invite.title")} role="region">
        <div className="font-medium">{t("peers.invite.title")}</div>
        <p className="text-sm text-muted-foreground">{t("peers.invite.hint")}</p>
        {open ? (
          <div className="flex flex-wrap items-center gap-3">
            <code data-testid="invite-code" className="rounded-md border px-3 py-1.5 font-mono text-2xl tracking-widest">
              {formatCode(open.code)}
            </code>
            <span className="text-sm text-muted-foreground">
              {t("peers.invite.left", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}
            </span>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(cancelInvite)}>
              {t("peers.invite.cancel")}
            </Button>
          </div>
        ) : (
          <>
            {inv?.state === "burned" && (
              <p className="text-sm text-status-blocked">
                {t("peers.invite.burned", { who: inv.login ?? t("peers.unknownLogin"), time: date(inv.at) })}
              </p>
            )}
            {inv?.state === "used" && <p className="text-sm">{t("peers.invite.used", { name: inv.name })}</p>}
            <Button className="self-start" disabled={busy} onClick={() => void invite()}>
              {t("peers.invite.open")}
            </Button>
          </>
        )}
      </Card>

      <Card className="gap-3 p-4" aria-label={t("peers.add.title")} role="region">
        <div className="font-medium">{t("peers.add.title")}</div>
        <p className="text-sm text-muted-foreground">{t("peers.add.hint")}</p>
        <form onSubmit={add} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("peers.add.url")}
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("peers.add.urlPlaceholder")}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("peers.add.code")}
            <input
              required
              autoComplete="off"
              autoCapitalize="characters"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("peers.add.codePlaceholder")}
              className="rounded-md border bg-background px-3 py-2 font-mono tracking-widest"
            />
          </label>
          <Button type="submit" className="self-start" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t("peers.add.submit")}
          </Button>
        </form>
        {added && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              {t("peers.add.done", { name: added.name })} {testText(added.test)}
            </p>
            {/* Reciprocity is a second pairing, the other way, by the same gestures (ADR 0049 §1). */}
            <Button variant="outline" size="sm" className="self-start" disabled={busy || Boolean(open)} onClick={() => void invite()}>
              {t("peers.add.reciprocal", { name: added.name })}
            </Button>
          </div>
        )}
      </Card>

      <Card className="gap-2 p-4" aria-label={t("peers.inbound.title")} role="region">
        <div className="font-medium">{t("peers.inbound.title")}</div>
        {view.inbound.length === 0 && <p className="text-sm text-muted-foreground">{t("peers.none")}</p>}
        <ul className="flex flex-col divide-y">
          {view.inbound.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.login ?? t("peers.noLogin")}
                  {p.pairedAt && ` · ${t("peers.pairedAt", { date: date(p.pairedAt) })}`}
                  {" · "}
                  {p.launch === null ? t("peers.launch.all") : p.launch.length === 0 ? t("peers.launch.none") : t("peers.launch.some", { envs: p.launch.join(", ") })}
                </div>
              </div>
              <Button
                variant={pending === `revoke:${p.name}` ? "destructive" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => confirm(`revoke:${p.name}`) && void run(() => revokePeer(p.name))}
              >
                {pending === `revoke:${p.name}` ? t("peers.confirm") : t("peers.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <PeerEnvironments environments={view.environments} onChange={load} />

      <Card className="gap-2 p-4" aria-label={t("peers.outbound.title")} role="region">
        <div className="font-medium">{t("peers.outbound.title")}</div>
        {view.outbound.length === 0 && <p className="text-sm text-muted-foreground">{t("peers.none")}</p>}
        <ul className="flex flex-col divide-y">
          {view.outbound.map((p) => (
            <li key={p.name} className="flex flex-col gap-1.5 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.url}
                    {p.pairedAt && ` · ${t("peers.pairedAt", { date: date(p.pairedAt) })}`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await testPeer(p.name);
                        setTests((m) => ({ ...m, [p.name]: r.test }));
                      })
                    }
                  >
                    <Link2 />
                    {t("peers.test")}
                  </Button>
                  <Button
                    variant={pending === `forget:${p.name}` ? "destructive" : "outline"}
                    size="sm"
                    disabled={busy}
                    onClick={() => confirm(`forget:${p.name}`) && void run(() => forgetPeer(p.name))}
                  >
                    {pending === `forget:${p.name}` ? t("peers.confirm") : t("peers.forget")}
                  </Button>
                </div>
              </div>
              {tests[p.name] && (
                <p role="status" className={`text-xs ${tests[p.name]!.state === "ok" ? "" : "text-status-blocked"}`}>
                  {testText(tests[p.name]!)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
