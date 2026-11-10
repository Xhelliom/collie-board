# 12. 🔵 Three accessibility holes: a heading per screen, a reachable dismiss, a barrier per route

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `9265b4e` *fix(a11y): a title per screen, a reachable dismiss, a barrier per route* |
| Files | `web/src/router.tsx`, `web/src/routes/{root,home,history,settings}.tsx`, `web/src/components/{status-area,space-view,agent-chat}.tsx` |
| Extraction | **Clean cherry-pick**, minus the one line that adds `<h1 className="sr-only">Board</h1>` to the fork's own board route. Everything else is upstream's, and no card is in sight. |

Three unrelated gaps, deliberately shipped together because each is a few lines and they share no
mechanism. Worth saying up front what this is *not*: it isn't an accessibility retrofit. The app
already carries 112 `aria-*` attributes, respects `prefers-reduced-motion` everywhere, and restores
focus when a sheet closes. These are the three places that were simply missed.

**Heading hierarchy.** Only the settings screen had an `<h1>`; home, pane, history and space had
none, and each carried `<h2>`s (the triage groups, the Spaces overview) or `<h3>`s (the pane
switcher's sections) with no parent — a screen reader navigating by heading landed in an orphan tree
(WCAG 1.3.1). Every screen now has exactly one `<h1>`. Where the visible title already exists as a
heading-shaped thing it was promoted in place (history, space); where it lives *inside a button* it
could not be, because a heading inside a button is not exposed as one — so home ("Herd"), board and
settings get an `sr-only` `<h1>`, and the pane gets one carrying the pane's own name, hoisted into a
single `paneTitle` the header title block and the heading now share. The pane switcher's `<h3>`s
needed no change: they hang off the sheet's own `Drawer.Title`, which Radix renders as an `<h2>`.

**The status line.** `StatusArea` is a `role="status" aria-live="polite"` div, and when the tone was
`error` it also took an `onClick`. No `<button>`, no `tabIndex`, no Enter/Space handling, and the ✕
had no label. That made the *one* notice in the app you must actively dismiss — every other tone
fades on its own — the one thing a keyboard could not reach. The ✕ is now a real
`<button type="button" aria-label="Dismiss">` and the live region keeps its role and stays inert; a
region that is also a click target announces cleanly as neither.

**The error barrier.** There was one `errorElement`, on the root, so a render error or a loader throw
anywhere took the whole app down — a broken pane blanked the board and the dashboard with it. `pane`,
`card`, `board` and `pane/:paneId/history` each get their own, which is all React Router needs to stop
the fall at the leaf and keep `RootLayout` mounted. `RootError` grew one optional `to` prop and now
*navigates* to the parent (card → board, history → its pane, otherwise home) instead of
`window.location.assign`-ing: the router remounts the parent and re-runs its loader, which clears the
boundary without discarding everything already in memory.

---
