# Upstream posture

Collie Board is a fork of [`AltanS/collie`](https://github.com/AltanS/collie), not a departure from
it. Collie's bridge, security model, PWA and socket adapter are used as-is and are still the
authority on how any of that works. This file records what that means in practice, so the decision
doesn't have to be re-derived from commit archaeology later.

## Keeping rebaseable

The fork's surface against upstream is deliberately narrow. New behaviour lives in NEW files:

```
bridge/db.ts            cards, sessions, reviews, journal (bun:sqlite)
bridge/cards.ts         lifecycle + reconciliation against the snapshot
bridge/board-routes.ts  the whole /api/cards surface
bridge/git.ts           worktree resolution + diff
bridge/context.ts       the context gauge
bridge/handoff.ts       the handoff sequence
bridge/wrapup.ts        the closing report a filed card asks its agent for
bridge/integrate.ts     merge / PR / conflict-resolve / cleanup for a card's branch
bridge/copilot.ts       the copilot
bridge/adapters.ts      per-agent divergence
bridge/gallery.ts       the scratchpad image gallery
web/src/lib/board*.ts   the client half
web/src/lib/lightbox.ts the viewer's store + a session's image set
web/src/routes/{board,card,gallery}.tsx
web/src/components/{card-tile,card-diff,context-gauge,new-card-sheet,image-lightbox}.tsx
```

What was touched in upstream files, and why — this list is the thing to keep short:

| File | Change |
|---|---|
| `bridge/server.ts` | `historyParams` takes the `after` cursor; one import + one dispatch block for the board's paths (`/api/cards`, `/api/repos`, `/api/board`, `/api/backup`), plus `board`/`copilot`/`context` in the options; `withCardFields()` + `ContextTracker.enrich()` overlaid onto the primary session's snapshot panes; the `GET /api/notifications/log` + `DELETE /api/notifications/log/:id` + `POST /api/notifications/log/:id/read` routes and the snapshot's `notifications.count` — brick 18 in the ledger; one import + one dispatch block for `/api/gallery` — brick 21 |
| `bridge/index.ts` | construct the board, copilot and adapters; four `engine.onUpdate` hooks; the `NotifyLog` and its coordinator hook — brick 18 in the ledger |
| `bridge/notifications.ts` | one optional constructor argument (`onFire`) and the call that feeds the bell's history — brick 18 in the ledger; `summarize`'s single-alert branch composes through `notify-content.ts` — brick 24; **the deepest cut of the four**: a second optional argument (`subtitleFor`) that the fired alert is now AWAITED on, an `Alert.subtitle` field `summarize` renders, and the timer callback split out into an `async fire()` with a resolved-while-we-waited guard. Deliberate and priced in ([NOTIFY_AUDIT.md §N10](./NOTIFY_AUDIT.md)): a push's body arriving in a second, silent message never reaches a sleeping phone, because every message shares one collapse topic — verified on a locked device. Only the copilot is slow enough to earn a second message; the free tiers cost ~80ms against a 30s debounce, so the first push waits for them. It makes brick 24's `notify-content.ts` extraction heavier — that is the bill; `summarize`'s digest body lists the SUBJECTS instead of `paneDisplayName` — brick 25 |
| `bridge/config.ts` | the `board*` config block |
| `systemd/collie-board.service` · `scripts/collie-board-ctl.sh` (unit heredoc) | `PrivateTmp=yes` removed — a `--user` unit can only mount inside a user namespace, where ssh refuses every root-owned config and no `git push` runs ([ADR 0008](./.adr/0008-the-user-unit-cannot-have-a-mount-namespace.md)) |
| `bridge/herdr-client.ts` | per-request timeout, and the worktree / agent / metadata methods |
| `bridge/transcript.ts` | `latestUsage()`, `resolveByCwd()`, `resolveWithoutSession()`, `pageAt()`, and `pageEntries`' `after` cursor; `toolImagePath()` + the tool part's `image` field — brick 21 in the ledger |
| `bridge/state-engine.ts` | `statusSince` — the poll already knows every status change, so it stamps the pane it just saw switch; a first sighting stays unstamped — brick 22 in the ledger |
| `bridge/types.ts` | `AgentView.branch` (card-backed panes only) and `ctxPct/ctxTokens` (any agent pane — G1/G2/G3); `notifications.count` — brick 18 in the ledger ; `AgentView.statusSince` — brick 22 |
| `web/src/lib/api.ts` | `apiRequest` re-export; `ApiError` exported so a custom fetch can raise one; `fetchPane`'s `unwrapped` flag; `fetchHistory`'s `after`; `getNotifyLog()` — brick 18 in the ledger; a refusal's own `error` sentence becomes the message, unprefixed — brick 20; `fetchGallery()` + `galleryImageUrl()` — brick 21 |
| `web/src/lib/loaders.ts` | `paneLoader` picks the read source from the raw-terminal pref; `galleryLoader` — brick 21 in the ledger; `HomeData.notifyCount` — brick 18 |
| `web/src/lib/types.ts` | same `AgentView` fields as `bridge/types.ts`; `paneDisplayName()` param loosened to a `Pick` so a `CardRuntime` can use it too; `NotifyLogEntry` + `notifications.count` — brick 18 in the ledger; the tool part's `image` and `GalleryImage` — brick 21; `AgentView.statusSince` — brick 22; `notifyVerb`/`notifyWhere`/`notifyWhat` deleted, the three surfaces composing through `notify-content.ts` instead — brick 25 |
| `web/src/router.tsx` | three routes; a per-leaf `errorElement` |
| `web/src/routes/home.tsx` | a Board row; the screen's `<h1>`; `<UsageGauge>` under the triage — brick 23 in the ledger |
| `web/src/components/agent-chat.tsx` | mount `<ContextGauge>` above the composer (G1); the screen's `<h1>`; the terminal ⇄ reading toggle + body swap; History gated on "is an agent pane" rather than on `agentSessionId`; the breadcrumb's `<PaneMenu>` segment at both breakpoints — brick 16 in the ledger; the ⋯ sheet's `Images` row — brick 21 |
| `web/src/routes/{root,history,settings}.tsx` · `web/src/components/{status-area,space-view}.tsx` | the three a11y gaps — one `<h1>` per screen, a real dismiss button on the error status line, error barriers per leaf — brick 12 in the ledger; `root.tsx` additionally mounts `<AgentToasts>` (brick 19); `settings.tsx` additionally mounts `<FollowUpsControl>` and `<MaxAgentsControl>` (fork-only, the board's switches) and the Gallery row; `history.tsx` additionally carries the session's image set into `<TranscriptView>` and the header button that opens it — brick 21 in the ledger |
| `web/src/components/agent-card.tsx` | branch + ctx% on the tile (G2), mirroring `CardTile`; the pane number, so two agents in one tab aren't the same card twice — brick 16 in the ledger ; how long an idle/done pane has been settled — brick 22 |
| `web/src/hooks/use-transitions.ts` | returns the transitions as toasts instead of writing to the shared status line — brick 19 in the ledger; the toast's own sentence replaced by one `notifyContent()` call, the same composition the push and the bell render — brick 25 |
| `web/src/hooks/use-display-prefs.ts` | wrap defaults ON below 640px (`wrapDefaultFor`); `rawTerminalPref()` for the loader; the `reading` mode flag |
| `web/src/components/ui/sheet.tsx` | rewritten over Vaul — [ADR 0003](./.adr/0003-vaul-owns-the-sheet-gesture.md) |
| `web/src/components/session-switcher.tsx` | dropped the manual `createPortal` the sheet no longer needs |
| `web/src/components/transcript-view.tsx` · `web/src/App.tsx` · `web/src/lib/nav.ts` | an image-bearing tool part renders as the picture; the viewer host mounted beside the router (unmounted while the idle cover is up); `galleryPath()` — brick 21 in the ledger |
| `web/src/test/setup.ts` | put `localStorage` back when Node 24+ shadows jsdom's, and shim pointer capture + `<dialog>`'s modal methods |
| `web/src/index.css` | `.tag-chip` — the derived tag colour, light and dark ([ADR 0005](./.adr/0005-one-tag-per-card-its-colour-derived-from-its-name.md)). One self-contained block among the other named classes, so it rebases as an addition |

Rebasing means resolving those twenty, not the whole tree. Keep it that way: if a change wants to
spread, it usually wants to be a new module with a hook instead. `setup.ts`'s localStorage fix,
`use-display-prefs.ts` and the raw-terminal read source (`server.ts` / `herdr-client.ts` / `api.ts` /
`loaders.ts`) are pure upstream material — they are in the ledger, and once merged they leave this
list again.

The sheet is the one entry here that is **not** meant to leave: upstream has not taken the Vaul
dependency and this fork is not arguing that it should. Its bug fix is still PR-able, but only from
the commit that made it — see brick 9 in [`UPSTREAM_PRS.md`](./UPSTREAM_PRS.md).

## What is PR-able, and what isn't

**PR-able** — generic, stateless, in the spirit of a mobile remote control. The list, with the
commits that carry each brick and whether it is a clean cherry-pick, is maintained in
**[`UPSTREAM_PRS.md`](./UPSTREAM_PRS.md)**. Start with the `collie-ctl.sh` fixes: one commit, pure
bug fix, hits every user.

**Fork-only** — these change the nature of the project. Collie is deliberately stateless: an
ephemeral, single-operator mirror. Grafting a database onto it is a change of kind, not an
extension, and a refusal would be entirely reasonable. **Never submit these as one PR:** cards, the
board, SQLite, worktree-per-card, session chaining, the copilot.

## Contact

Issue creation is restricted on `AltanS/collie` and there are no Discussions, so the plan of "open an
introduction issue" doesn't work as written. PRs are not restricted. The order that actually works:

1. Land one small, obviously-useful PR (the context gauge is the natural first). An accepted PR opens
   a conversation better than a message does.
2. Then ask the scope question, with working code to point at.

The project is neither young nor quiet (~143★, 19 forks, ~40 issues). The issue restriction is
probably a response to volume. **Do not build the plan around a reply** — fork, build, and treat the
upstream conversation as a bonus.

## Licence

Collie is MIT and this fork stays MIT. `LICENSE` keeps Altan Sarisin's copyright with the fork's
added below it, which is what MIT requires and also just the right thing to do.

Herdr is AGPL, but nothing here links its binary — a socket client is not a derived work.

## Marketplace — decided

**Decision (2026-07-28): a real GitHub fork**, [`Xhelliom/collie-board`](https://github.com/Xhelliom/collie-board),
public. Contributing back won over discoverability, because **GitHub only accepts a pull request
whose head repository is a fork of the base** — from a standalone repo, every brick in the PR-able
list above would need a second repo and a cherry-pick before it could even be offered. The whole
upstream strategy hangs on that one mechanic, so it decided the question.

The cost, and it is real: the herdr marketplace index reads GitHub repository search, and **GitHub
excludes forks from search results by default**. This repo may therefore never appear in the
listing, even with the `herdr-plugin` topic. If that turns out to matter more than expected, a
standalone mirror can be pushed alongside later — the reverse (turning a plain repo into a fork) is
not possible at all, which is the other half of why this way round is the safer bet.

| Option | Gain | Cost |
|---|---|---|
| **GitHub fork** ← chosen | PRs upstream are trivial; lineage visible | listing uncertain |
| Standalone repo | indexed normally | no PR to upstream without a second repo |

## Open questions

- [x] Public or private at first → **public**, 2026-07-28.
- [x] Fork vs standalone → **fork** (above).
- [ ] Confirm whether the `herdr-plugin` topic gets the fork listed anyway (~30 min refresh). If
      not, decide whether a standalone mirror is worth maintaining.
- [ ] Set `COLLIE_BOARD_UPDATE_REPO=Xhelliom/collie-board` in the plugin `.env` so the in-app update
      banner works. It is opt-in precisely because pointing it at upstream would nag about versions
      this tree isn't.
