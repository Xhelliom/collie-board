# 28. 🔵 A notification coordinator that doesn't assume its alerts are panes

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

`NotificationCoordinator` keys everything by `paneId`: `pending` and `outstanding` are keyed by it,
`FiredAlert.paneId` is required, and `summarize` reads the deep-link off the MAP KEY. Nothing in the
coordinator's job needs that. Debouncing, coalescing into one slot, counting a digest by state and
retracting when the work is handled are all true of any alert with a lifecycle — the pane is just the
only thing upstream currently has one for. The assumption costs nothing until something else wants to
notify, and then it costs a rewrite.

The key becomes an opaque string. `arm(key, alert)` and `retract(key)` are the coordinator's two
verbs; `onTransition` is one caller of `arm`, keyed by pane id because that is the id a transition
has. `paneId` moves onto `Alert` as an optional field, so the deep-link is read off the ALERT and an
alert without a pane simply carries none.

| | |
|---|---|
| Commit | `17e978d` *feat(notify): a board fact reaches the phone, in the herd's slot* |
| Files | `bridge/notifications.ts` (the key, the two verbs, `Alert.paneId`, `retract` replacing a private `resolve` and its duplicate in `onTransition`), `bridge/notify-content.ts` + its byte copy `web/src/lib/notify-content.ts` (`notifyCardId` reads the missing pane), `bridge/notify-subtitle.ts` (one gate per entry point, and the deep-link re-stamped on the silent update), `web/src/hooks/use-transitions.ts` + `web/src/components/notification-bell.tsx` (pass / stop duplicating the rule) |
| Extraction | **Needs a subset taken.** Drop the `stalled` and `ready` statuses, their markers and their digest lines — they are the fork's words for a card whose work stopped and for a card a finished predecessor unblocked, and upstream has no card. What is left is generic and applies as-is: the opaque key, the optional `paneId`, and the two `notify-subtitle.ts` fixes. |

**One real upstream bug travels with it.** The copilot's silent second push re-rendered the same
composition *without* the alert's `cardId`, so the deep-link a first push had earned silently
reverted to the pane. Upstream has no card, so this half only matters downstream — but the shape of
the mistake (a second render that rebuilds a payload from fewer fields than the first) is worth
carrying: both renders now go through the same two composition calls.

**One upstream bug it does NOT fix, and the note is the point.** Alerts whose timers come due in the
same tick still send one message each — the callbacks run separately with microtasks drained between
them, so each `fire` renders before the next is invoked, and the digests differ because they grow.
A "same as the last render" guard was tried and dropped: it never matches. Collapsing the batch needs
the render deferred by a macrotask, which changes when every caller sees one; the ceiling is written
at `emit` rather than half-fixed.

**`notifyCardId` gains its second rule, not a special case.** An alert with no pane has exactly one
place its tap can go, and it is not a terminal. Written once in the shared composition, the bell stops
carrying its own copy of the same condition.

---
