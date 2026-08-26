import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useNavigate, useRevalidator, useRouteLoaderData } from "react-router";

import { BottomSheet } from "@/components/ui/sheet";
import { deleteNotifyLogEntry, getNotifyLog, markAllNotifyLogRead, markNotifyLogEntryRead } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { cardPath } from "@/lib/board";
import { panePath } from "@/lib/nav";
import { notifyCardId, notifyContent } from "@/lib/notify-content";
import type { NotifyLogEntry } from "@/lib/types";

// The bell, in the app header (app-header.tsx), on every screen. A push notification collapses into
// one live slot and is retracted the moment the work is handled — right for a lock screen, and the
// reason a ping you slept through leaves no trace. This is where it does: the bridge records every
// alert it fires (bridge/notify-log.ts), and tapping an entry lands you in the pane that pinged — or
// on the CARD, when that is what the entry is about (lib/notify-content.ts's `notifyCardId`).
//
// Fetched when the sheet opens, not polled: history doesn't move while you aren't looking at it, and
// the snapshot poll runs every 1.5s — putting 50 entries in it would be a permanent tax for a list
// consulted once in a while.

/** A history row IS the notification that fired, re-rendered — same composition, plus the subtitle
 *  the copilot back-patched into the entry after the push had already gone out. */
const content = (e: NotifyLogEntry) => notifyContent(e, e.subtitle ?? null);

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // The badge count rides the snapshot poll (bridge sends notifications.count — unread only) rather
  // than fetching the history: 50 entries every 1.5s to render one number.
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
  const revalidator = useRevalidator();
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

  // Dismiss is optimistic — the row leaves under your thumb — but the bridge is what makes it stick
  // across a close/reopen, so a failed DELETE puts the entry back where it was (newest id first)
  // rather than pretending it's gone until the next fetch says otherwise.
  const dismiss = (entry: NotifyLogEntry) => {
    setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? prev);
    deleteNotifyLogEntry(entry.id).catch(() =>
      setEntries((prev) => (prev ? [...prev, entry].sort((a, b) => b.id - a.id) : prev)),
    );
  };

  // Marking is not dismissing: every row stays, it just stops counting. Optimistic like the dismiss
  // above, and rolled back to what was on screen if the bridge refuses — the bridge is what holds
  // the read state, so a client-only mark would walk right back in on the next open.
  const markAllRead = () => {
    const before = entries;
    setEntries((prev) => prev?.map((e) => (e.read ? e : { ...e, read: true })) ?? prev);
    markAllNotifyLogRead().then(
      () => revalidator.revalidate(),
      () => setEntries(before),
    );
  };

  return (
    <>
      {/* Only while something is unread — with the badge already empty, this would be a button whose
          job is done. */}
      {entries.some((e) => !e.read) && (
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={markAllRead}
            className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:bg-muted"
          >
            Mark all read
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-1 overflow-y-auto">
        {entries.map((e) => (
          <li key={e.id} className={e.read ? "flex items-start opacity-55" : "flex items-start"}>
            <button
              type="button"
              onClick={() => {
                onPick();
                // Tapping IS reading it: the badge counts unread, so the number has to drop now rather
                // than on the next poll — revalidate once the bridge has actually taken the mark.
                markNotifyLogEntryRead(e.id).then(
                  () => revalidator.revalidate(),
                  () => {},
                );
                // A "card to read" entry opens its card; anything else opens the pane. The entry
                // carries its own session, so a ping from another herd lands in that herd rather
                // than looking up a pane id in the one you happen to be viewing.
                const card = notifyCardId(e);
                navigate(card ? cardPath(card) : panePath(e.paneId, e.session));
              }}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-[10px] py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-muted/60 active:bg-muted"
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
                {/* The same sentence the push sent, composed once (lib/notify-content.ts): the marker
                    and the SUBJECT here, then where/repo/what happened on the line below, which is
                    free to run to two lines because the copilot's subtitle lands in it. */}
                <span className="block truncate text-sm font-medium">{content(e).title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{content(e).body}</span>
              </span>
              <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">{timeAgo(e.ts)}</span>
            </button>
            <button
              type="button"
              onClick={() => dismiss(e)}
              aria-label={`Delete notification: ${content(e).title}`}
              className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-opacity hover:opacity-100 active:bg-muted/60"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
