import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate, useRouteLoaderData } from "react-router";

import { BottomSheet } from "@/components/ui/sheet";
import { getNotifyLog } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { notifyVerb, notifyWhat, notifyWhere, paneDisplayName, type NotifyLogEntry } from "@/lib/types";

// The bell, in the app header (app-header.tsx), on every screen. A push notification collapses into
// one live slot and is retracted the moment the work is handled — right for a lock screen, and the
// reason a ping you slept through leaves no trace. This is where it does: the bridge records every
// alert it fires (bridge/notify-log.ts), and tapping an entry lands you in the pane that pinged.
//
// Fetched when the sheet opens, not polled: history doesn't move while you aren't looking at it, and
// the snapshot poll runs every 1.5s — putting 50 entries in it would be a permanent tax for a list
// consulted once in a while.

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // The badge count rides the snapshot poll (bridge sends notifications.count) rather than fetching
  // the history — same reason the list itself doesn't: 50 entries every 1.5s to render one number.
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const count = root?.notifyCount ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Notifications (${count})` : "Notifications"}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:bg-muted"
      >
        <Bell className="size-[18px]" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-blocked px-1 text-[10px] font-bold tabular-nums text-white"
          >
            {count}
          </span>
        )}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Notifications">
        {open && <NotifyLogList onPick={() => setOpen(false)} />}
      </BottomSheet>
    </>
  );
}

/** Mounted only while the sheet is open, so its fetch runs on open and its state resets on close. */
function NotifyLogList({ onPick }: { onPick: () => void }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<NotifyLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getNotifyLog()
      .then((e) => live && setEntries(e))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't read the history.</p>;
  }
  if (entries === null) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing has pinged yet. Alerts land here as they fire — including the ones you slept through.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 overflow-y-auto">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => {
              onPick();
              // The entry carries its own session, so a ping from another herd lands in that herd
              // rather than looking up a pane id in the one you happen to be viewing.
              navigate(panePath(e.paneId, e.session));
            }}
            className="flex w-full items-start gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
          >
            <span
              className={
                e.status === "blocked"
                  ? "mt-1.5 size-2 shrink-0 rounded-full bg-status-blocked"
                  : "mt-1.5 size-2 shrink-0 rounded-full bg-status-done"
              }
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              {/* Name + verb + WHERE (session/repo) share this line — short, stable identity, so the
                  line below is free for WHAT (the copilot subtitle, which can run to two lines). */}
              <span className="block truncate text-sm">
                <span className="font-medium">{paneDisplayName(e)}</span> {notifyVerb(e.status)} ·{" "}
                <span className="text-muted-foreground">{notifyWhere(e)}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{notifyWhat(e)}</span>
            </span>
            <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">{timeAgo(e.ts)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
