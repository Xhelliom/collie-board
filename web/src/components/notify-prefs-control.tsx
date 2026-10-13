import { useT, type MessageKey } from "@/i18n";
import { BellRing, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useNotifyPrefs } from "@/hooks/use-notify-prefs";
import type { NotifyPrefs } from "@/lib/api";

// Which lifecycle events are worth a push. Bridge-wide (fans out to every device, like the snooze),
// so the copy says so. Six switches: "Needs input" (blocked, default on), "Finished" (done,
// default off), "Board alerts" (board, default on — the board's OWN facts, one switch for the whole
// family rather than one per event), "Unblocked" (ready, default OFF — the board's one fact that
// opens a door instead of reporting a problem, so it ships silent and gets its own switch rather
// than riding "Board alerts"), "App updates" (updates, default on), and "Copilot rephrase"
// (default off). That
// last one governs the SLOW half of the subtitle only (notify-subtitle.ts): the agent's own last
// line always lands, and this asks the copilot to rewrite it into one sentence — so the switch is
// about spending copilot quota on polish, not about having a subtitle at all.
// Optimistic toggle with revert on failure — see useNotifyPrefs.

const ROWS: ReadonlyArray<keyof NotifyPrefs> = ["blocked", "done", "board", "ready", "updates", "copilotSubtitle"];

export function NotifyPrefsControl() {
  const t = useT();
  const { prefs, busy, toggle } = useNotifyPrefs();

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <BellRing className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">{t("settings.notify.title")}</div>
            <p className="text-sm text-muted-foreground">{t("settings.notify.hint")}</p>
          </div>
        </div>
        {!prefs && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {prefs &&
        ROWS.map((key) => {
        const label = t(`settings.notify.${key}` as MessageKey);
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{label}</div>
              <p className="text-xs text-muted-foreground">{t(`settings.notify.${key}.hint` as MessageKey)}</p>
            </div>
            <Switch
              checked={prefs[key]}
              disabled={busy}
              onCheckedChange={(next) => void toggle(key, next)}
              aria-label={label}
            />
          </div>
        );
      })}
    </Card>
  );
}
