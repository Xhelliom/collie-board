import { useEffect, useState } from "react";
import { Bell, ChevronRight, Images, Loader2, SquareTerminal } from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { AutoHandoffControl } from "@/components/auto-handoff";
import { BackupControl } from "@/components/backup-control";
import { BuildStamp } from "@/components/build-stamp";
import { UpdateBanner } from "@/components/update-banner";
import { ConnectionInfo } from "@/components/connection-info";
import { FollowUpsControl } from "@/components/follow-ups-control";
import { GateControl } from "@/components/gate-control";
import { LanguageControl } from "@/components/language-control";
import { FlowsControl } from "@/components/flows-control";
import { TemplatesControl } from "@/components/templates-control";
import { MaxAgentsControl } from "@/components/max-agents-control";
import { Card } from "@/components/ui/card";
import { NotifyPrefsControl } from "@/components/notify-prefs-control";
import { SnoozeControl } from "@/components/snooze-control";
import { ThemeControl } from "@/components/theme-control";
import { UpdateCheckControl } from "@/components/update-check-control";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { fetchConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { usePushControl } from "@/hooks/use-push";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { galleryPath } from "@/lib/nav";
import type { PushAvailability } from "@/lib/push";

const TABS = ["display", "notifications", "agents", "system"] as const;
type Tab = (typeof TABS)[number];

// Settings page — appearance + the push-notification toggle. Reachable via the nav (a root tab).
// Lives under the root route, so the snapshot polling/push-setup in RootLayout keeps running behind it.
export function SettingsRoute() {
  const t = useT();
  const { state, busy, setEnabled } = usePushControl();
  const [error, setError] = useState<string | null>(null);
  // One tab at a time: the page grew too long to scroll. Not remembered — it is a visit, not a mode.
  const [tab, setTab] = useState<Tab>("display");

  // Settings lives under the root route, so the live snapshot (bridge + device auth) is right here.
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  // The build the bridge reports it's serving — handy in the diagnostics panel alongside the local
  // stamp in the footer. Best-effort: stays undefined if the bridge is unreachable.
  const [serverBuild, setServerBuild] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => alive && setServerBuild(c.build))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // "On" = the user hasn't disabled it AND a live subscription exists on this device.
  const on = Boolean(state && !state.userDisabled && state.subscribed);
  const blocked = Boolean(state && state.availability !== "ready");
  // When blocked we can still allow turning OFF a lingering subscription, but never turning ON.
  const toggleDisabled = busy || !state || (blocked && !on);

  async function toggle(next: boolean) {
    setError(null);
    const res = await setEnabled(next);
    if (next && !res.ok) setError(reasonText(res.reason, t));
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm lg:max-w-none flex-1 flex-col">
      <AppHeader title={t("settings.title")} />

      {/* The screen's one h1 — the header already says "Settings", but as a SectionLabel span. Kept
          outside <main>, whose space-y-4 would otherwise hand its first real child a stray margin. */}
      <h1 className="sr-only">{t("settings.title")}</h1>

      {/* No page-level ceiling above `lg` (same as the other routes) — but settings rows are
          label-on-the-left / control-on-the-right, not a grid, so the column caps ITSELF at a
          reading width rather than stretching a switch 2000px away from its label. The cap is on
          the ROWS, not on <main>: capping the scroller put its scrollbar 700px in from the right
          edge of the window, which reads as a broken page rather than a narrow column. */}
      <div role="tablist" aria-label={t("settings.tabs")} className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] lg:px-5">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === name ? "border-foreground/50 bg-accent" : "bg-card/70 text-muted-foreground hover:border-foreground/25",
            )}
          >
            {t(`settings.tab.${name}`)}
          </button>
        ))}
      </div>

      <main className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4 lg:px-5 lg:py-6 lg:[&>*]:max-w-3xl">
        {tab === "display" && (
          <>
            <ThemeControl />
            <LanguageControl />
            <StatusLineControl />

            {/* The gallery isn't a root tab: it's something you go and look at now and then, not one of
                the four places the app is about. A row here rather than a fifth item in the nav bar. */}
            <Card className="gap-0 py-0">
              <Link to={galleryPath()} className="flex items-center gap-3 p-4">
                <Images className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t("settings.gallery.title")}</div>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.gallery.hint")}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </Card>
          </>
        )}

        {tab === "notifications" && (
          <>
            <Card className="gap-0 py-0">
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Bell className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{t("settings.push.title")}</div>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.push.hint")}
                    </p>
                  </div>
                </div>
                {state ? (
                  <Switch
                    checked={on}
                    disabled={toggleDisabled}
                    onCheckedChange={toggle}
                    aria-label={t("settings.push.title")}
                  />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </div>

              {state && blocked && (
                <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
                  {availabilityNote(state.availability, t)}
                </p>
              )}
              {error && (
                <p className="border-t border-border/60 px-4 py-2.5 text-xs text-status-blocked">
                  {error}
                </p>
              )}
            </Card>

            {state && state.availability !== "server-off" && (
              <>
                <NotifyPrefsControl />
                <SnoozeControl snoozedUntil={root?.snoozedUntil ?? null} />
              </>
            )}
          </>
        )}

        {tab === "agents" && (
          <>
            <MaxAgentsControl />
            <FollowUpsControl />
            <AutoHandoffControl />
            <GateControl />
            <TemplatesControl />
            <FlowsControl />
          </>
        )}

        {tab === "system" && (
          <>
            {/* On-demand upstream update check (independent of push) — drives the footer UpdateBanner. */}
            <UpdateCheckControl />

            <BackupControl device={root?.device} />

            <ConnectionInfo bridge={root?.bridge} device={root?.device} build={serverBuild} />
          </>
        )}

        {/* Update nudge + build stamp, grouped and pinned to the bottom of the page. */}
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <UpdateBanner />
          <BuildStamp />
        </div>
      </main>
    </div>
  );
}

/** Per-device display pref: the agent's statusline strip above the composer on the pane screen. */
function StatusLineControl() {
  const t = useT();
  const { prefs, setStatusLine } = useDisplayPrefs();
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <SquareTerminal className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">{t("settings.statusLine.title")}</div>
            <p className="text-sm text-muted-foreground">
              {t("settings.statusLine.hint")}
            </p>
          </div>
        </div>
        <Switch checked={prefs.statusLine} onCheckedChange={setStatusLine} aria-label={t("settings.statusLine.title")} />
      </div>
    </Card>
  );
}

type T = ReturnType<typeof useT>;

function reasonText(reason: PushAvailability | undefined, t: T): string {
  switch (reason) {
    case "insecure":
    case "server-off":
    case "denied":
    case "unsupported":
      return t(`settings.push.err.${reason}`);
    default:
      return t("settings.push.err.default");
  }
}

function availabilityNote(a: PushAvailability, t: T): string {
  switch (a) {
    case "insecure":
    case "server-off":
    case "denied":
      return t(`settings.push.note.${a}`);
    case "unsupported":
      return t("settings.push.err.unsupported");
    case "ready":
      return "";
  }
}
