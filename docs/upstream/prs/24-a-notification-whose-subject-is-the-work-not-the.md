# 24. 🔵 A notification whose subject is the work, not the worker

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

Every push upstream sends reads `<agent> needs you` / `<agent> is done` over `<workspace> · <cwd>`.
Verified live on a 9-pane herd: `paneLabel` and `sessionName` are null on every pane and herdr
reports the pane KIND (`"claude"`) as `agent`, so all three sources `paneDisplayName` consults
collapse to the same word. The title is a constant — three simultaneous alerts read `claude is done`
three times — and the body's `workspaceLabel` is the workspace, which for a worktree-backed pane is
not the repo. Nothing in the notification says *which* work.

| | |
|---|---|
| Commit | *(this branch)* `feat(notify): the push is about the work, not the agent that did it` |
| Files | `bridge/notify-content.ts` (new, + test), `bridge/notifications.ts` (one import, `summarize`'s single-alert branch), `bridge/notify-subtitle.ts` (one import, `pushSubtitle`'s render) |
| Extraction | **Clean cherry-pick.** `notify-content.ts` reads `status`, `cwd` and an optional `cardTitle` off the alert — with no card the subject falls through to the repo, which is exactly upstream's only case. Nothing else in it knows the board exists. |

**One rule, two fields:** title `<marker> · <subject>`, body `<repo> · <what happened>`. The subject
is the work the pane is doing (a card title here; upstream, the repo). The marker (`Needs you` /
`Done`) leads because it is what survives an OS truncation on a lock screen.

**The repo appears exactly once.** It is the subject when there is nothing better, and moves into the
body when there is — so the two fields never say the same thing twice. Upstream's `cardTitle ?? cwd`
body fallback is the worst possible one: it echoes the title. An empty body beats an echo.

**Derived from `cwd`, not `workspaceLabel`.** A pane in `…/worktrees/<repo>/<branch>` has the repo
one segment above the last; anywhere else the last segment is the repo. `workspaceLabel` is whatever
the workspace was named, which is only the repo by coincidence.

**One composer, two callers.** The coordinator's first plain push and the later silent subtitle
update render through the same function. They used to compose their own sentence each, which is how
a perfectly-rewritten subtitle still came back under a title reading `claude is done`.

**The branch stays out**, though it is right there in the `cwd`: it is a slug of the subject, so it
could only write the subject twice. Its place is a history you read on a screen, not a glance at a
lock screen.

*Extraction cost since:* §N10 cut deeper into `notifications.ts` — the coordinator now awaits a
`beforeFire` hook before it renders, and `summarize` reads an `Alert.subtitle` the composer is given.
`notify-content.ts` itself is untouched and still lifts cleanly; the CALLER around it diverged, so the
cherry-pick now has to re-plant one call site rather than one line.

---
