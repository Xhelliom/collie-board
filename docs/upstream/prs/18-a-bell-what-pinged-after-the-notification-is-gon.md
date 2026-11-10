# 18. 🔵 A bell: what pinged, after the notification is gone

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

Upstream's notification coordinator is deliberate about the lock screen — one slot for the whole
herd, retracted the moment the work is handled. The corollary is that a ping you slept through leaves
**no trace anywhere**: nothing in the app says an agent needed you at 3am, and nothing takes you to
the pane that asked. The alert is the only record, and it deletes itself.

| | |
|---|---|
| Commits | `e042754` *feat(notify): a bell in the header, and the history of what pinged behind it* · `bb4a1ec` (the dismiss) · `9a022c6` (the badge) · `3a42ff1` (the tap reads it) · `fe5ddb5` (mark all read) |
| Files | `bridge/notify-log.ts` (new, + test), `bridge/notifications.ts` (one optional ctor arg, one call), `bridge/server.ts` (one GET + one DELETE + one POST route, plus `notifications.count` on the snapshot), `bridge/index.ts` (construct + wire), `web/src/components/notification-bell.tsx` (new, + test), `web/src/lib/{api,types}.ts`, `web/src/lib/loaders.ts` (`notifyCount` on `HomeData`), `web/src/components/app-header.tsx` (one mount) |
| Extraction | **Clean cherry-pick.** No card, no board, no database — the header component upstream would mount it in is this fork's own, so that one line moves to wherever upstream's header lives. |

**Recorded where the alert fires, not where it renders.** The hook sits in the coordinator, on the
transition that survives the debounce — so an alert that resolved at your desk inside the debounce
window never enters the history either, and one entry means one agent, carrying its `paneId`. The
sink's summary can't do that job: a multi-agent digest has no pane to deep-link to, and a silent
retraction re-renders the same summary again.

**Before the mute gate, on purpose.** An alert that fired during quiet hours is precisely the one you
go looking for afterwards. Snooze suppresses the buzz; it doesn't rewrite what happened.

**In memory, bounded, not persisted.** Fifty entries in a ring, gone with the bridge. It is runtime
state — the thing this history exists to survive is the *notification*, not the process.

**Fetched when the sheet opens.** The snapshot poll runs every 1.5s and fifty entries in it would be
a permanent tax on a list you consult occasionally.

**The badge is one integer on the snapshot, not the history.** The same arithmetic that keeps the
list off the poll (fifty entries every 1.5s) puts the *count* on it: it's the one thing you need
without opening anything, it costs a field, and it hangs off a poll that already runs — the bell
never grows a loop of its own. Dismissing a row therefore decrements the badge on the next tick,
without a second source of truth to keep in step.

**An entry can be thrown away, one row at a time.** A history you can't prune is a history you stop
reading: the ping you already handled sits above the one you haven't. `DELETE /api/notifications/log/:id`
drops one entry from the ring and answers 204 whether it was there or not; the row leaves optimistically
and comes back if the call fails. Read-level, like every other route in that block. Still no "clear
all" — the ring already forgets at 50, and the bridge restart clears it for free; the bulk gesture
below marks, and marking is the one that wanted to be bulk.

**The badge counts what is UNREAD, and tapping an entry is what reads it.** `POST /api/notifications/
log/:id/read` sets a flag on the ring entry; `count()` stops counting it. A badge that only a *delete*
could clear made the number a chore-list rather than a signal — you had already been to the pane. The
entry stays in the history, dimmed: read is not dismissed, and the two verbs stay separate (tap = I
saw it, X = I don't want it). The flag lives on the entry, so it survives a reload exactly as far as
the entry itself does, and the tap revalidates the snapshot so the number drops under your thumb
rather than on the next 1.5s poll.

**"Mark all read" is the bulk gesture, and delete is not.** `POST /api/notifications/log/read-all`
flips every entry's flag; the button sits above the list and only while something IS unread, so the
badge-is-empty state never offers a button whose job is done. The asymmetry with the per-row X is the
point: "I have seen these" is a thing you mean about the whole list at once, "I do not want this"
almost never is — one is a sweep, the other is a decision per row. Same read-level and same
idempotence as the per-entry mark, and the same optimistic-with-rollback shape in the sheet, since
the bridge is what holds the flag.

**A notification that arrived while the app was open lands here too** — the bridge records the alert
it pushed, and whether a visible client made the service worker suppress the banner is downstream of
that.

---
