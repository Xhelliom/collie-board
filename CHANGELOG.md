# Changelog

All notable changes to Collie Board are recorded here. Entries at 0.17.0 and below are
inherited from upstream Collie (AltanS/collie); the fork starts at 0.18.0. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). The newest `## [x.y.z]` heading **must** match the
`version` in `herdr-plugin.toml`, `package.json`, and `web/package.json` (enforced by
`scripts/check-version.sh`). See [`CLAUDE.md`](./CLAUDE.md) → *Versioning* for the bump policy.

## [0.79.1] - 2026-08-05

### Fixed
- `GET /api/backup` and `POST /api/backup/restore` fell through to the SPA static fallback (200, `text/html`) instead of reaching `handleBoardRoute` — the dispatch guard in `server.ts` only matched `/api/cards` and `/api/repos`, never updated when the backup routes landed. Settings → Backup failed with a generic "Couldn't back up." (09aa7eb).
- Once routed correctly, `GET /api/backup` still failed the same way from any non-loopback Host (e.g. over Tailscale): `checkAccess`'s Origin-required rule assumed `level === "write"` always meant a mutating method, which browsers tag with `Origin` even same-origin — but a same-origin GET never carries one. The rule now only applies to non-GET methods, so the backup export (write-gated solely for its device-auth check) stops tripping it (a08c308).

## [0.79.0] - 2026-08-05

### Added
- Composer: typing `/comp` offers the matching slash commands as you type, from the same catalog the Agent button opens. Picking fills the input, never sends; the button and its palette are unchanged (0473d39).

## [0.78.0] - 2026-08-05

### Added
- Settings → Backup → Restore…: read a backup file back, two-tap confirmed. `POST /api/backup/restore` validates the whole document, then safety-exports the current state to `<stateDir>/backups/` before writing a byte — a failed net aborts the import (ef2965a).

## [0.77.0] - 2026-08-05

### Added
- Settings → Backup: one-tap download of everything the plugin persists — cards, sessions, reviews, journal, server prefs and this browser's prefs — as one JSON file, `GET /api/backup`, write-gated (386b014).

## [0.76.0] - 2026-08-05

### Added
- Idle-lock cover reworked: never locks a hidden page, auto-resumes on returning to the foreground, sits above a still-mounted router instead of unmounting it — a paused screen no longer eats an in-progress draft (c5e6776).
- Glass catch-up cover: outlives the lock through the resume refetch, gallop badge (reused `NavMark`) instead of a static one while it's fetching (c5e6776).

### Fixed
- Composer draft is lost on every pane switch (navigate away and back) — persisted per-pane in a module-scoped map so `AgentChat`'s remount (`key={paneId}`) no longer wipes unsent text (6050f3e).
- Symlink planted alongside a Claude transcript log could be followed out of the transcript root by `followContinuation`'s sibling scan and served via `GET /api/pane/:id/history` — containment now revalidated on the scan's pick (23a55d4).
- Agent-alert and clear pushes sent at default web-push urgency, which Android's Doze/App-Standby bucketing could defer indefinitely — now sent at `urgency: "high"` (ecaa53b).
- `collie-board-ctl.sh update` failed with "You are not currently on a branch" on a `herdr plugin install`-managed checkout (detached, shallow) — now advances via fetch + re-detach in that shape, falls back to `git pull --ff-only` for a linked clone (32ab75a).
- A statusline taller than 3 rows made the input-box detector give up entirely, stalling sends with "Message didn't reach the input box" even though the text was in the box — ceiling raised to 8 (c4f57d8).

### Changed
- `ARCHITECTURE.md` / `CLAUDE.md` no longer describe the idle-lock as unmounting the router or as a security measure — see [ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md) (c5e6776).

## [0.75.0] - 2026-08-05

### Added
- `PaneMenu`: the breadcrumb's `pN` chip drops down this space's panes; the handle's whole-herd sheet is unchanged (6d75e8a).

### Fixed
- Desktop pane header carries the `› pN` segment the mobile breadcrumb already had — two panes of one space+tab rendered an identical header, so switching looked like a no-op (6d75e8a).
- Space view's pane card shows its pane number — two agents in one tab were the same card twice (6d75e8a).

## [0.74.0] - 2026-08-05

### Added
- `POST /api/cards/<id>/refine` — one free-text correction, applied by the copilot to the card as it stands (57ad962).
- `refinePrompt`: the current card + the instruction, one rule ("change nothing else"), no duplicate check / split / tag (57ad962).
- Card page → Rework: "Correct with the copilot" opens an instruction box; the journal quotes the correction back (57ad962).

### Changed
- `PromptBox` takes a `placeholder` and a `sendLabel`, so the agent follow-up and the copilot correction share one box (57ad962).

## [0.73.1] - 2026-08-05

### Fixed
- Board tile: the "copilot is editing this" marker moved from the meta row to the status row, so it shows on the bare-title card the copilot is actually working on (f2b51dd).

## [0.73.0] - 2026-08-04

### Added
- `AgentView` carries `cardId`/`cardTitle` — `withCardFields` already looked the card up for `branch`, now returns the rest of what it already had (bb3b554).
- The pane's desktop context rail gets a "Carte portée" block off that new field: title, branch, "Ouvrir la carte" / "Handoff" (bb3b554).
- The context rail also shows the token count and an explicit "Contexte" / "Statusline de l'agent" heading, matching the mockup (bb3b554).
- Desktop sidebar: a "Spaces" list under the nav on `/` (mirrors the board's own repo list), and per-item counts (needs-you on Herd, space count on Spaces) (bb3b554).
- Card page: "Reformuler" next to "Éditer" in the header, alongside the existing Rework section's copy (bb3b554).
- Board card meta row: `GitBranch` icon in front of the branch, and an acceptance-criteria count (`ListChecks` + number) (bb3b554).

### Changed
- Card page desktop: dropped the `lg:max-w-6xl` ceiling (matches board/home now) — Spec/Acceptance keep their own `max-w-[70ch]` for readability (bb3b554).
- Card title's cap widened from `30ch` to `46ch` — it was wrapping titles that had the room to fit on one line (bb3b554).
- Card page desktop: Intégration and Classer move from the document column into the action rail next to the live pane/composer, instead of sitting mid-document between Spec and Journal (bb3b554).
- Sub-task table (desktop): every row now shows its status in a fixed column, not just blocked/orphaned ones; the tag rides as the title's sibling instead of getting clipped by its `truncate`; the "depends on" text is capped at `200px` instead of crowding out the rest of the row (bb3b554).
- Sub-task list footer ("Nouvelle sous-tâche" / "Lier une carte existante") moved inside the same bordered container as the rows, not a separate box below it (bb3b554).
- Board card tile: the tag no longer sits alone in an otherwise-empty status row — it rides the title row when there's no status/repo to show alongside it (bb3b554).
- Board toolbar shows a removable chip for the active repo scope — previously invisible until the board was empty (bb3b554).
- `/space/:id`'s back chevron and empty-space fallback go to `/spaces`, not the dashboard — a leftover from before Spaces had its own page (bb3b554).

### Fixed
- The terminal mirror's dark background stopped at the transcript's own height on a short pane, showing the page background below it on a tall desktop screen — moved onto the scrollport instead of the `<pre>` (bb3b554).
- The dark theme's native scrollbar (and other browser-drawn controls) rendered light — missing `color-scheme` on `:root`/`.dark` (bb3b554).
- Container card's right column briefly duplicated Intégration/Classer in both columns while the move above landed (bb3b554).
- The Herd dashboard's header lost its brand mark on mobile when the nav shell moved it to the tab bar (a plain `Dog` icon there, same weight as the other three tabs) — a small static echo of the mark is back on the dashboard's own header, mobile only (bb3b554).

### Removed
- Desktop sidebar: Settings is no longer duplicated as a fourth main nav row — it lives in the footer only, beside SessionSwitcher/BuildStamp, matching the redesign's own nav spec (bb3b554).

## [0.72.0] - 2026-08-04

### Added
- Persistent nav shell — 248px sidebar desktop, tab bar mobile — replacing the per-screen headers (691a74b).
- Dashboard triage renders three weight classes: loud card (needs you), medium card (working), bare row (idle·done) (691a74b).
- Session pane's desktop layout splits into three columns: pane list, mirror, context rail (691a74b).
- Sub-task management on the card page: add, link an existing card, reorder by drag, set depends-on, detach (691a74b).
- Spaces overview page (`/spaces`), per-space tab chips, `spacePath` gains a `tab` param (691a74b).
- `NonNominalPanel` — one shared shape (dot + title + sentence) for read-only, orphaned-pane and empty/filtered states (691a74b).
- Idle·done rows show `{name} · {workspace}` plus the repo (last segment of `cwd`) on every breakpoint — same-named agents were otherwise indistinguishable (691a74b).
- The mobile context row's %/tokens chip is tappable, toggling which unit it shows (691a74b).

### Changed
- Board lanes are unified between mobile and desktop (`BOARD_LANES`), dropping the old CSS-order trick (691a74b).
- `AppHeader` becomes a plain contextual toolbar (`title`/`subtitle`/`children`/`rightLead`/`rightTrail`/`override`); `SettingsGear` removed (691a74b).
- `--brand` / `--label-size` / `--label-tracking` / `--status-chip-foreground` tokens added; primary actions use `variant="brand"` (691a74b).
- `ChatInput` gets an explicit `bg-background` instead of `bg-transparent` — it was reading as grey-on-grey against the composer's chrome bar in light mode (691a74b).

### Fixed
- The mobile context row and the desktop pane list column no longer render a hard-coded dark background regardless of the active theme — both were missing the `dark:` prefix on `oklch(0.165 0.006 250)` (691a74b).
- The mobile context row dropped its own background entirely instead — the ctx-bar/pane chip inside it (both `bg-muted`) had become invisible once the row itself turned `bg-muted` too (691a74b).

## [0.71.0] - 2026-08-03

### Added
- The copilot tags every card it writes: a reformulated dump, each child of a split, each review follow-up (c9571be).
- The tag inventory rides inside the prompt, so the choice is made with the board's vocabulary in view (c9571be).
- A proposed tag one hyphen from an existing one is snapped onto the existing spelling — `front-end` becomes `frontend` (c9571be).
- A new tag only when none fits; a split child and a review follow-up fall back to the tag of the card they came from (c9571be).

### Changed
- A tag already on a card survives a reformulation — the copilot's tag only ever fills a hole, and stays editable by hand (c9571be).

## [0.70.0] - 2026-08-03

### Added
- Board: scope to one repo from a strip of chips above the columns — the sessions side's space strip, one axis over — with "All" as the global view. [ADR 0006](./.adr/0006-the-board-scopes-by-repo-and-remembers-it.md) (f604920).
- The scope is remembered between visits, "All" included, so the board opens where you were working (f604920).
- Repo and tag strips compose: scoping to a repo narrows the tag strip to that repo's tags (f604920).
- In the global view a tile names its repo; under a scope it doesn't — the strip already said it (f604920).
- A card created from a scoped board starts in that repo (f604920).

## [0.69.0] - 2026-08-03

### Added
- A card's tag can be typed at creation and changed when editing — the field is optional, and an empty box means no tag (5e017fe).
- The tags already in use are offered in that same field: tappable coloured chips, and a `<datalist>` that filters them as you type (5e017fe).
- Typing an existing tag in another case or spacing selects it instead of minting a second spelling — `normalizeTag` now folds client-side too, so the match is visible before the card is created (5e017fe).

## [0.68.1] - 2026-08-03

### Fixed

- Board: a card depending on an already-merged-and-cleaned-up predecessor kept showing an empty diff forever, with no merge/PR offered — its `baseRef` now gets repointed to a live ref when the predecessor's branch is deleted (84373f5)

## [0.68.0] - 2026-08-03

### Added

- Board: filter to one tag from a strip above the columns, cleared by "All" or by the tag itself (0892cd1)
- Board: a filtered board with no match says which tag, instead of reading as an empty board (0892cd1)

## [0.67.0] - 2026-08-03

### Added
- A card can carry one tag, shown as a coloured chip before its title. The colour is computed from the tag's name and stored nowhere, so one tag is one colour everywhere and on every device — [ADR 0005](./.adr/0005-one-tag-per-card-its-colour-derived-from-its-name.md) (706b99d).
- The tag inventory is derived, never registered: `BoardDb.listTags()` bridge-side, `tagsOf(cards)` client-side (706b99d).
- Tags are normalised in the database — lowercased, whitespace-collapsed, 24 chars — so the copilot's writes get the same identity rules as the API's (706b99d).

## [0.66.1] - 2026-08-03

### Fixed
- The statusline strip keeps every line the TUI paints under the input box, not just the first. With a `statusLine` hook configured, the hook's own line hid Claude's — branch, model and context figure were all lost behind it, and `⏵⏵ auto mode on` with them (531f7d7).

## [0.66.0] - 2026-08-03

### Added
- Pane history works without `herdr integration install claude` — the transcript is resolved from the pane's own process, the route the context gauge already used. History and reading mode were inert by default before this (9fd958e).
- Reading mode shows a draft left on the terminal's `❯` line, dashed and named "Draft in terminal · not sent" — it lives in no log, so the thread read as though you never typed it (5182d61).
- Reading mode says "still writing" while the agent works: a turn reaches the log only when it ends (5182d61).

### Fixed
- **A resumed conversation served the wrong transcript.** "The log born closest after the process started" picked a startup log that died at 31 entries while the resumed conversation grew to 20 MB elsewhere — stale history, and another session's occupancy on the context gauge. The rule is now the log the process is actually writing to (9fd958e).
- **Reading mode stopped updating after the first fetch.** It ticked on `revision`, which herdr 0.7.x always reports as 0; it now rides the pane poll's own heartbeat (5182d61).

## [0.65.0] - 2026-08-03

### Added
- A reading mode on the pane screen: `[terminal] [reading]` in the header, persisted per device. Reading renders the agent's own transcript — the Markdown it actually wrote, never cut to a terminal's columns — with the composer, statusline and gauge unchanged below it (73f43f5).
- Reading mode banners a waiting TUI dialog and hands you back to the terminal, so an agent can't sit blocked behind a question you never see (73f43f5).
- Markdown tables render: a scrollable `<table>` up to three columns, one labelled card per row beyond that (73f43f5).
- `pageEntries` takes an `after` cursor, so a live view follows a transcript instead of re-pulling the archive on every tick (c9a2a32).
- Ledger brick 15: the reading mode and its cursor, none of which needs a card (73f43f5).

### Fixed
- Agent prose no longer breaks mid-sentence on a phone. herdr cuts the pane at ~81 columns and the mirror wrapped that again at ~50; reading mode reads the source that was never wrapped instead (73f43f5).

## [0.64.0] - 2026-08-03

### Added
- Drag reorders inside a column, not just between columns — a fractional `position` (SQLite stores a REAL in an INTEGER-affinity column), so it stays one PATCH on one card (a3f3092).
- A ghost of the dragged card sits in the exact slot it will land in, pushing the column open as you move (a3f3092).
- The flying card is a styled clone via `setDragImage` — opaque, shadowed, tilted 2° (a3f3092).
- Each lane scrolls on its own above `lg`, with its heading sticky (a3f3092).

### Changed
- The lanes read left to right as the flow: `To do → Doing → To review → Done`. The phone keeps urgency-first order (a3f3092).
- Sub-tasks scatter into their own columns on a wide board; the container stays as a summary tile with its status chips. **Fixes a board that reported "Done 0" with fifteen finished sub-tasks** (a3f3092).
- The board and the dashboard drop their max-width; agent lists become `auto-fill minmax(24rem,1fr)` grids. The card page keeps its ceiling — it is a document (a3f3092).
- The drag state survives the drop until fresh data lands, so a move no longer visibly undoes itself first (a3f3092).
- `status` is only sent when it changes, so a reorder no longer journals a move that never happened (a3f3092).
- Ledger brick 14 follows the width rule: surfaces widen, documents don't (059eb5b).

### Fixed
- The drop outline is drawn inside the box — the new per-lane scroller clipped it — with symmetric padding (a3f3092).
- The drop slot no longer flickers between "here" and "at the end" while dragging within one column (a3f3092).

## [0.63.1] - 2026-08-03

### Fixed
- A drop re-reads the card's status at drop time — a poll landing mid-drag could otherwise let a manual status be written onto a card the herd had just picked up (7db2bb0).
- The drop highlight no longer strobes as the pointer crosses the cards inside a column (`dragleave` fires on every child hop) (7db2bb0).
- Drop targets get a minimum height while a card is in hand; a one-card column was ~60px of surface in a lane 800px tall (7db2bb0).
- The hovered column doubles its outline to the ring colour instead of tinting with `accent`, which sits 3% off the background (7db2bb0).

### Changed
- A dropped card lands at the top of its new column (`position: min - 1`), the rule new cards already follow (7db2bb0).

## [0.63.0] - 2026-08-03

### Added
- Drag a card between the board's manual columns (backlog ↔ ready ↔ done) on a desktop — the platform's own drag, no library, no touch gesture (f959a5c).
- `canDropCard` refuses both a herd-owned source (its agent would be sent home) and a herd-owned target (the next poll would undo it) (f959a5c).
- An empty manual column shows itself while a card is in hand, so the last card out of Ready doesn't take the drop target with it (f959a5c).

### Changed
- `MANUAL_STATUSES` moves from `routes/card.tsx` to `lib/board.ts` — "Move to" and drag-and-drop now name the same list (f959a5c).

## [0.62.0] - 2026-08-03

### Added
- Desktop mode: above `lg` the board lays out as four lanes (Needs you · In progress · Ready · Done), each keeping its columns as labelled sub-sections (f42cc9c).
- `CardTile` adapts to its own container, not the viewport — chevron dropped under 24rem, badge onto its own line under 20rem (f42cc9c).
- Sheets come in from the right on a wide screen and up from the bottom on a phone — one component, one `direction` apart (f42cc9c).
- `useMediaQuery` / `useIsDesktop`: reactive `matchMedia` at Tailwind's `lg`, for the one thing CSS can't switch (f42cc9c).
- Home, space and card pass 640px; agent and space lists become two- or three-across grids (f42cc9c).
- The card page splits into a durable half (spec, acceptance, journal) and a live half (pane, context, prompt, handoff) (f42cc9c).
- Ledger brick 14 — the desktop mode's app half, which belongs upstream (c8cf8d1).

### Changed
- `CommandPalette` no longer overrides the sheet's max height; the override clipped the right-hand variant (f42cc9c).

## [0.61.0] - 2026-07-30

### Added
- The theme names two motion curves (`ease-enter` decelerating, `ease-exit` accelerating) and two durations (150ms/250ms); the short one is the default every bare `transition-*` already rides, so a call site only names a duration to ask for the long one (5e76d50).
- `--font-sans` is declared explicitly — it only restates the system stack, but an inherited default is not a decision (5e76d50).
- [ADR 0004](./.adr/0004-the-terminal-mirror-uses-the-platform-mono.md) records why the terminal mirror uses the platform's mono, and what would justify self-hosting a face after all (5e76d50).

### Changed
- One type scale, three roles: `text-base` content, `text-sm` supporting, `text-xs` metadata. All 47 arbitrary font sizes are gone — they pinned 10-11px, below Tailwind's smallest rung rather than between two of them, so they folded onto it instead of minting a new one (5e76d50).
- Content reads a rung larger: the body of a message, the agent name in the sidebar, a container's title, and markdown headings, which sat level with or below the prose they introduced. Metadata stayed small — that gap is the hierarchy that was missing (5e76d50).
- `"JetBrains Mono"` no longer leads `--font-mono`. It was never loaded — no `@font-face`, no preload, no woff2 in `public/` — so the mirror already rendered in the platform's mono while the CSS claimed otherwise (5e76d50).
- The connection banner enters and exits on different curves, and `EXIT_MS` moved 200 → 250 to stay locked to the CSS duration it delays the unmount for (5e76d50).

## [0.60.1] - 2026-07-30

### Fixed
- A card's dependency line now also shows on the card's own detail page, not just the board tile — the tile-only fix in 0.60.0 missed the screen you actually land on after tapping a dependent card (104c9d9).
- `startCard` no longer forks a dependent card from a predecessor branch that was deleted by post-merge cleanup — that handed `worktree.create` an invalid ref and failed instantly with an unhelpful 502; now falls back to the card's own base ref, same as when the predecessor never ran (4bf57b6).

## [0.60.0] - 2026-07-30

### Added
- A card's tile shows its declared dependency even once satisfied — green check when the predecessor is done, amber lock while it still blocks — instead of only showing anything while blocking (1705c55).

### Fixed
- `worktree.create`/`worktree.open` get a 20s RPC budget instead of the generic 5s one, which could time out under load and surface as a false 502 even though nothing was actually wrong (c5c9622).

## [0.59.1] - 2026-07-30

### Fixed
- Every screen carries exactly one `<h1>` — home, board, pane, history and space had none, and their `<h2>`/`<h3>`s hung off nothing, so heading navigation landed in an orphan tree (WCAG 1.3.1) (9265b4e).
- The error status line's ✕ is a real `<button>` with an `aria-label` — dismissing an error was the one action in the app a keyboard couldn't reach, and it's the only notice that doesn't fade on its own (9265b4e).
- A pane that fails to render no longer takes the board and the dashboard with it: pane, card, board and history each have their own `errorElement` (9265b4e).

### Changed
- The error barrier's button navigates to the parent screen (card → board, history → its pane, otherwise home) instead of reloading the whole app (9265b4e).

## [0.59.0] - 2026-07-30

### Added
- A review's follow-up cards link back to the card that spawned them — the Review section now lists each as a tappable row (title, status), not just a count, so a card that isn't worth keeping is one tap from wherever you'd archive or delete it (2d7cc5b).

### Changed
- `review.todos` carries `{title, cardId}` instead of a bare title; old rows still decode fine (2d7cc5b).

## [0.58.1] - 2026-07-30

### Fixed
- A post-`done` review's `todos` land as full cards (spec + acceptance), not bare titles — the same regression the `split` path already guards against (65337c1).

## [0.58.0] - 2026-07-30

### Added
- Context gauge on every agent pane, including one launched by hand — the tracker walks the snapshot's agent panes instead of the board's open sessions (106b723).

### Changed
- The percentage for a pane with no card lives in the tracker's memory and ships with the snapshot; nothing runtime is written to the database (106b723).
- `withCardFields` carries `branch` only — context now has a single source, the tracker (106b723).
- Cost measured before widening: median 10–23 ms per pane per 30 s, worst 110 ms on an 18 MB log, ~1 % of one core for twelve agents — cheap enough to skip the narrower "open pane + card panes" variant (106b723).
- One expression of "which transcript does this pane read", one clock read per tick, and no nullable percentage in the tracker's memory (2a2bfa3).

## [0.57.0] - 2026-07-30

### Added
- Raw terminal now reads herdr's un-wrapped scrollback, so the mirror's own wrap is the only one left — the mode already bypasses every Claude grammar, so nothing depends on the terminal's fixed-width lines there (06c1b56).

### Fixed
- `pane.read`'s un-wrapped source is `recent_unwrapped`, not the hyphenated name the client's type and `HERDR_API.md` both carried — the socket rejects the hyphen with `invalid_request` (06c1b56).

### Changed
- UI_AUDIT §B1 answered on measurements, not on argument: un-wrapping changes **nothing** on a Claude pane (129 → 129 lines, zero lines past the terminal width — Claude's TUI wraps its own prose first), so it does not fix the transcript's double wrap. Real only on shell panes: 599 → 501 lines (06c1b56).

## [0.56.2] - 2026-07-30

### Fixed
- The "has uncommitted changes" merge warning no longer names a base branch that isn't actually checked out — it only fires when the repository really is on `state.base`, so it stops misattributing dirt from an unrelated checkout to a stale predecessor branch. (c4f672c)

## [0.56.1] - 2026-07-30

### Fixed
- A sheet no longer draws a hairline across its top: it read as a bright seam in dark and a grey one in light, cutting the rounded corners instead of edging them (c4aa87c).
- The sheet's grab handle and the swipe-up handle that opens it are one `GrabHandle`, at the larger of the two sizes — the same affordance either side of one transition was drawn two different ways (c4aa87c).

## [0.56.0] - 2026-07-30

### Changed
- The sheets run on Vaul: dismiss on velocity (a flick), a close threshold proportional to the panel's height, elastic edges, and a return whose duration follows the distance (0dade2b).
- `BottomSheet` and `SideSheet` are one component, one `direction` apart; their props are unchanged, so the nine call sites moved untouched (0dade2b).
- The iOS keyboard is handled in the four sheets with fields — Safari ignores the `interactive-widget` hint that covers Chrome (0dade2b).
- Decision and measured bundle cost (+20.3 kB gzip): [ADR 0003](.adr/0003-vaul-owns-the-sheet-gesture.md) (0dade2b).

### Fixed
- A sheet traps focus properly, lands it on the panel rather than the ✕, and returns it to the opener (0dade2b).
- A sheet's rounded top corners are visible again, and the bright line along its top edge is gone: the header kept the opaque background and backdrop-blur it needed as a `sticky` element inside the scroller, and as a flex sibling nothing passes under it (c1a173b).

### Removed
- The hand-rolled drag, the `backdropArmed` guard, and `session-switcher`'s manual portal — all made redundant. Net −170 lines (0dade2b).

## [0.55.0] - 2026-07-30

### Added
- Arming a two-tap confirm (Kill, /clear, Ctrl-D, …) now buzzes 10 ms where the Vibration API exists (Android); a no-op elsewhere.

### Changed
- Global typography (UI_AUDIT R5): `text-wrap: pretty` on paragraphs, `balance` on headings.
- The three horizontal strips (Spaces, Tabs, Panes) now scroll-snap, so a chip lands aligned instead of half-cut at the edge.

## [0.54.0] - 2026-07-30

### Added
- Appearance setting (UI_AUDIT D2): Light / Dark / System toggle in Settings, replacing the hard-coded `class="dark"` — an anti-FOUC inline script in `index.html` and `useThemeSync` keep it live, including on OS theme changes.

### Changed
- The 18 flat neutral tokens (UI_AUDIT R1) now carry a cold tint — `oklch(L 0.006 250)` instead of `oklch(L 0 0)` — matching `--status-idle`/`--status-unknown`'s existing hue.
- Header and composer chrome bars, the collie-mark ring badge, and the incomplete-answers warnings (UI_AUDIT §6.2) now read from tokens (`--chrome`, `--muted-foreground`, `--status-working`) instead of hard-coded `zinc-800`/`zinc-500`/`yellow-500`.
- The terminal mirror (`ansi-output.tsx`) now renders on its own pinned-dark surface (`--terminal-background`/`--terminal-foreground`/`--terminal-muted`) instead of following the app theme, so the VS-Code-dark ANSI palette stays readable in light mode too.

## [0.53.1] - 2026-07-30

### Fixed
- The wrapup ask now tells the agent to commit its work FIRST, before writing the closing note — the note's existence is what gates the copilot review and unblocks merge/cleanup, so committing after it left both refusing on uncommitted work every time. (eeb303d)

## [0.53.0] - 2026-07-30

### Added
- Copy buttons (UI_AUDIT §6.4): a copy icon on every transcript code block, and a "Copy terminal buffer" control in the mirror's View row. Both disable (not hide) outside a secure context, since `navigator.clipboard` needs one.

### Changed
- The update banner's copy-command button now shares the same `useCopy` hook and also disables outside a secure context, instead of its own separate copy-with-confirm logic.

## [0.52.0] - 2026-07-30

### Changed
- Composer redesign (UI_AUDIT C1): the reply input is now full-width on its own line; the View + Controls rows collapse into one 44px-target action row (Keys/Quick/Agent/Attach/View). Find-in-output moved to the pane header.

## [0.51.1] - 2026-07-30

### Fixed
- Settings gear was under the 20px tap-target minimum — now `size-9` (36px), matching the History button. (1b28087)
- Settings screen now mounts the shared `AppHeader` instead of a bespoke one, so the connection dog/banner show up on the diagnostics page. (1b28087)
- Find highlight used two different yellows (pane mirror vs. transcript reader) for the same "match" meaning — unified behind `--find-hit` / `--find-hit-current` tokens. (1b28087)
- The pane-switch handle no longer renders when there's only one pane — nothing to switch to. (1b28087)

## [0.51.0] - 2026-07-30

### Added
- Context% now shows on the pane screen (by the statusline) and on the home agent tile — the two places you actually decide to hand off, which were the only two that didn't have it.
- Agent tiles (home) and board tiles now show the same fields: branch, short cwd, ctx% on both. A board tile backed by a live pane also shows its pane name next to the card title.

## [0.50.0] - 2026-07-30

### Added
- Worktrees now clean up on their own once a card's closing report settles (collected or given up on) — the same refusals as the manual tap, just without waiting for a second one. A per-card "Keep this worktree" switch opts out, off by default.

### Changed
- The resolve prompt tells the agent to re-check divergence even if it merged the base in before, and that merging back into the base is the operator's own tap, never its.
- The card screen refreshes the merge state on its own once a resolve's agent turn ends, instead of leaving the operator to remember to come back and recheck.

### Fixed
- Cleaning up a worktree right after filing a card done could delete the checkout — and the closing report being written into it — before the wrapup coordinator had collected it. Cleanup now refuses while a report is still in flight, and the card screen says so before the tap.

## [0.49.3] - 2026-07-29

### Fixed
- A drag that starts on a control or inside a scrollable region of a sheet scrolls, it no longer closes it (5151295).
- No more flicker when reopening a sheet: the drag offset is cleared on close, and `onClose` no longer re-attaches the listeners on every parent render (5151295).
- Closing a sheet is animated on all four dismiss paths instead of vanishing in one frame; a drag-close keeps the gesture's momentum (5151295).
- The page behind a sheet is frozen while it is open, and the drag writes its transform straight to the node — one less React render per frame (5151295).

## [0.49.2] - 2026-07-29

### Fixed
- Deleting a card takes two taps — the app's only irreversible gesture was its only unprotected one. Same `usePendingConfirm` as every other destructive action, armed on the card's own id, disarming after 3 s. (eda1aed)

## [0.49.1] - 2026-07-29

### Fixed
- **Restarting a filed card answered `agent_name_taken`.** Filing a card ends its session but not its pane ([ADR 0002](./.adr/0002-a-manual-status-ends-the-session-not-the-pane.md)) — so its agent is still sitting in the worktree, holding a name herdr requires to be globally unique. Start now **adopts** that agent instead of launching a second one over it. Found on a card that could not be restarted to settle the merge conflict blocking it.

### Notes
- An adopted agent is deliberately **not** prompted: it already lived the task, and re-sending the spec would make it start over. The card gets its session back and the operator decides what to say next.

## [0.49.0] - 2026-07-29

### Added
- **"What does this mean?" on a raw tool error.** Hands the verbatim git/herdr text to the copilot, which answers in two paragraphs — what it says, and what you can do — into the card's journal. It also says when the fault reads like a bug in the board rather than something you did.

### Notes
- Shown **only** for text relayed from git or herdr. The board's own refusals are already sentences aimed at a person; running an agent over them would add noise and spend quota for nothing.
- The prompt forbids acting before it shows the error, and says so in those words. The copilot is a Claude session like any other, so it can reach whatever skills the machine has — including one that drives this very API. Every action the copilot takes must keep going through bridge code, which is deterministic, gated and journalled: *the board makes a thing possible, the operator decides it happens.*
- Off when the copilot is off, like everything else it does — this spends the user's own quota.

## [0.48.0] - 2026-07-29

### Added
- **A card remembers whether its work landed.** "Merged into main · 2 h ago", the PR's link, "Worktree cleaned up — the branch was fully integrated", "Discarded — 4 commits thrown away". Read from the journal, which outlives the branch, the worktree and the pane; `done` on its own never said whether the code actually shipped.
- A conflict on a card with no running agent now offers to **start one again** instead of a button that answers 409. A filed card's session ended when it was filed — and that agent is exactly who settles the conflict.

### Notes
- The PR's *state* is deliberately not tracked. GitHub owns it; a copy here would be a second truth free to go stale the moment the bridge isn't looking, and it would cost a network call per card on a loop the fork's rules say not to add. The link is kept, and it is one tap.
- Nothing new is stored: the events were already written when the actions happened. This only reads them.
- A cleanup with no merge event is shown as evidence the work landed — cleanup is refused unless nothing is left to integrate, so it happening at all proves the branch was in. That is the case for anything merged by hand in a terminal.

## [0.47.0] - 2026-07-29

### Added
- **The board teaches your repo to ignore `.board/`, once, in `.git/info/exclude`.** Added when a card's worktree is created, idempotent, best-effort — an unwritable `.git` just means things stay as they were. It also carries a line saying where it came from, because someone will find it in a repo of theirs one day.

### Changed
- `worktree.remove` is now forced **only on discard**, where throwing uncommitted work away is the request itself. A cleanup has already been refused unless the checkout is clean, so it has nothing to force — and if herdr refuses it anyway, something really is in there and the refusal is right.

### Notes
- Why `info/exclude` and not the two obvious alternatives: committing the notes would carry them into the base branch on the first merge and make two cards that both handed off conflict over a file that has nothing to do with either; and `.gitignore` is versioned and shared with everyone who clones, while the board writes into repositories that have never heard of it. `info/exclude` is git's own answer — local, unversioned, one line, and shared by every worktree of the repo.

## [0.46.2] - 2026-07-29

### Fixed
- **Clean up still failed, on the board's own droppings.** herdr refuses to remove a checkout holding untracked files, and `.board/` — the handoff and wrapup notes this bridge writes into every card's worktree — is untracked by construction, so every cleanup hit it. `force: true` is now sent, which overrides *herdr's* check, not the board's: `refusalFor` ran first and knows both that `.board/` is ours and whether the commits are integrated, which herdr cannot.

## [0.46.1] - 2026-07-29

### Fixed
- **Clean up / Discard answered `herdr worktree.remove: invalid_request`.** The socket field is `workspace_id`; the CLI flag is `--workspace`, and the flag name is what got copied. Live-probed against 0.7.5 and written down in [`HERDR_API.md`](./HERDR_API.md) — the CLI and the socket disagreeing is exactly the kind of trap that file exists for.

## [0.46.0] - 2026-07-29

### Added
- **Discard.** For a card you are giving up on: closes the pane, removes the worktree, deletes the branch with `-D`, and files the card as `archived`. The one gesture in the board that destroys work knowingly, so it names what it is about to lose — "Throw away 3 commits and uncommitted work?" — and takes a second tap to mean it.
- Cleanup and discard now also handle a card whose workspace **herdr no longer knows** (a restart, a workspace closed by hand): the checkout is removed through git instead. Those were unreachable from the phone forever — `git branch -d` refuses while a worktree holds the branch, and nothing else in the app removes one.

### Notes
- `discard` is a separate action, not a `force` flag on cleanup, precisely so it cannot be reached for to make a refusal go away. It is the only thing here that skips the gate — overriding that gate is what it *is*.
- A discarded session is recorded as `abandoned`, and the card as `archived`, never `done`: a card whose branch was thrown away was not finished.
- Closing a *workspace* has no equivalent in the app (upstream closes panes and tabs only), which is why a finished card's space used to linger with no way to shift it. The card's own Clean up / Discard is that door.

## [0.45.0] - 2026-07-29

### Changed
- **Merge & done, PR & done — one gesture instead of two.** The natural order is "mark it done, then merge it", and it is the broken one: filing a card ends its session, so the agent that could settle a merge conflict is gone by the time the merge finds one. Integrating now files the card itself, and only if the integration succeeded. A failed merge leaves the card exactly where it was, agent included.
- `Done` is no longer offered on its own while the branch still holds commits — the card screen points at the combined button instead.

### Fixed
- Archiving a card whose agent was still running recorded the session as `done`. It is `abandoned`: interrupting a task is not finishing it, and the journal shouldn't claim a completion that never happened.

### Notes
- The order — close the session, set the column, ask for the closing report — now lives in one function, so the manual Done and the combined gesture cannot drift apart on it.

## [0.44.1] - 2026-07-29

### Fixed
- **git speaks the system's language, and we were reading it in English.** On a French system a conflict announces itself as `CONFLIT`, so the merge path's conflict test never matched: a conflict was reported as a generic git failure, with no offer to hand it to the agent. Every git and `gh` subprocess now runs under `LC_ALL=C`.
- **Merge no longer refuses just because the base has uncommitted changes.** Measured: git merges over changes it doesn't touch and preserves them — the common case, since the card worked elsewhere in the tree — and refuses by itself, before changing a byte, when they would collide. It knows the exact intersection; the old check only guessed, and blocked most merges for a collision that wasn't there.
- A merge that really would overwrite uncommitted work now says which files, and that nothing was changed.

### Notes
- That last case is deliberately not automated. A stash/pop around the merge conflicts in the working tree exactly when it matters, and an agent committing those changes would be putting a message on work nobody has decided to keep. **Open a PR** needs none of it — it never touches the base.

## [0.44.0] - 2026-07-29

### Added
- **The copilot checks for a duplicate.** A new card is triaged against the cards already on the board for the same repo; if it repeats one, the card links to it and says so. A suggestion, not a verdict — it never merges, never blocks a start, and "Not a duplicate" is one tap. `done` cards stay candidates: "you already did this last week" is the duplicate you are least likely to remember.

### Fixed
- A refused integration showed `/api/cards/…/integration → 409 {…}` with the reason off the end of the line. The bridge's own sentence is now what reaches the screen.
- Merge is disabled, with the reason, when the base has uncommitted changes or isn't checked out — refusals the client can see coming shouldn't need a failed tap to surface.

### Notes
- The suggestion is only ever made on a single card, never on a split: which of four fresh sub-tasks a duplicate would mean is a question the answer doesn't contain.
- The id the copilot answers with is checked against the board (exists, not itself, same repo) before it lands. An unverified id would put a dead link on a card, which is worse than no link.
- At most 60 candidates ride in the prompt, newest first — a board of hundreds would bury the note being triaged under its own history.

## [0.43.0] - 2026-07-29

### Added
- **The end of a branch's life, from the card.** A card with a branch now says where it stands (`3 commits not in main`), and offers four gestures: **Merge into main** (local, nothing pushed), **Open a PR** (pushes the branch, never touches the base), **Let the agent resolve it** after a conflict, and **Clean up worktree** once the work is in.
- A merge conflict is handed back to the card's own agent, which merges the base **into its branch** and settles it there — so the main repository never enters a conflicted state.

### Notes
- Every action refuses before it acts, and the gate is shared by the button, the request and the subprocess: nothing to merge · uncommitted work in the card's checkout · a dirty base · the base not checked out · not yet integrated. A refusal is a sentence on the card, never a repository left in a state nobody asked for.
- A conflicting merge is `--abort`ed before the request returns. The operator is on a phone and cannot resolve anything there.
- Cleanup is refused while the branch holds commits nobody else has, and `git branch -d` is the second lock on that door.
- `.board/` no longer counts as uncommitted work. It is this bridge's own scratch directory, so it is untracked in nearly every card checkout — counting it would have refused every cleanup, forever. Caught against a real worktree.
- The integration state is read ON DEMAND, never on the 1.5 s card poll: it costs git subprocesses.

## [0.42.0] - 2026-07-29

### Added
- **"The copilot has this card."** A card being rewritten or reviewed now says so — on its tile and on the card screen. Until now a card waiting on the copilot looked exactly like one it had abandoned, or like a copilot that was switched off.

### Notes
- In memory, never a column: a bridge restart cancels whatever was in flight, and the set forgets it in the same instant. The wrapup marker is the opposite case and stays in the database — there the work continues in an agent that outlives the bridge.

## [0.41.0] - 2026-07-29

### Added
- **A closing report.** Filing a card as Done asks its agent for one last note: what it actually did, a line per acceptance criterion (met / partly / not), and what it left out. It lands on the card and feeds the copilot's review — so what was left undone becomes the next cards instead of being lost with the pane.
- The copilot now reviews a card the operator files as `done`, not only one that lands in `review` on its own.

### Notes
- The report is asked for after the card is filed, never before: the card is already `done` and its session already closed, so nothing here can move it back. Reuses the handoff's asynchronous machine (marker in a column so a pending request survives a restart, 30-minute deadline, and the note ON DISK as the real "finished writing" signal). The pane is untouched, per [ADR 0002](./.adr/0002-a-manual-status-ends-the-session-not-the-pane.md).
- Filing a card as Backlog / Ready / Archive asks for nothing — those mean "not finished".

## [0.40.1] - 2026-07-29

### Fixed
- A card moved by hand to Done / Backlog / Ready / Archive now **stays there**. It didn't: the next poll reconciled it back to whatever its pane was doing, silently. Moving out of the live columns ends the card's session; the pane is left alone.
- A finished card no longer bounces in and out of `review` every turn. Herdr reports `done` for an instant then `idle` for as long as the agent waits at its prompt, and the board mirrored both — seen live, seven transitions in one session.
- That bounce made the copilot's review a **race**: it only reviews a card that is in `review` on the tick it looks, so a finished task could go unreviewed with nothing to say so.

### Notes
- [ADR 0002](./.adr/0002-a-manual-status-ends-the-session-not-the-pane.md) — why the session ends and the pane doesn't, and why neither herdr nor the copilot can be asked to decide a task is finished.

## [0.40.0] - 2026-07-29

### Added
- `COLLIE_BOARD_COPILOT_WORKSPACE` — what the copilot's workspace (and its agent) is called in the herd. Default `board`, unchanged.

### Fixed
- The comment claiming the copilot was found *by label* — it is found by working directory, and always has been. A wrong comment about the one thing that keeps a restart from stacking a second copilot is worse than none.
- `collie-board-ctl.test.sh` leaked `BUN_INSTALL` into the "bun off PATH" case, so it passed against the developer's real bun instead of the fixture — green for the wrong reason on any dev shell that sets it.

### Notes
- Renaming is cosmetic and safe: adoption is by `cwd`, so a rename can never orphan the running copilot. It names the *next* workspace — one already open in the herd keeps its label until you close it. Nothing ever closes that workspace; it survives a bridge restart on purpose.

## [0.39.0] - 2026-07-29

### Added
- **"Keep my wording — no rewrite" on the new-card sheet.** For the card you have already worded exactly. On by default, because a dictated dump is what that box is for.

### Notes
- Implemented by withholding `rawInput`, not by a new column. Creating a card with one is the **only** thing that makes the copilot act unasked (`board-routes.ts` gates on exactly that field); every later run is a button, and since 0.38.0 a confirmed one. So "leave this card alone" is already expressible in a field the schema defines as "a dump, to be processed" — a per-card flag would have been a second way to say the same thing, plus a migration. The spec is set either way, so the card is never left empty.
- The toggle resets to on each time the sheet opens: it describes one card, not a standing preference. `COLLIE_BOARD_COPILOT=off` remains the way to mean "never, for anything".

## [0.38.1] - 2026-07-29

### Fixed
- **The reformulate confirmation followed you to the next card.** One `<CardRoute />` serves every `/card/:cardId`, so the component is not remounted when you move between cards — an armed confirmation stayed armed and would have fired on the next card's first tap. The exact opposite of a guard. Reset on card id. (f5b9668)
- **A rejected save said nothing.** Linking two cards can now fail for a reason you can act on ("that would make a loop"), where before a patch only failed if the bridge was unreachable — and neither `save()` had a `catch`, so the sheet just sat there looking saved. It surfaces the bridge's message and keeps the sheet open.
- The editor re-seeded its fields from `card`, which is a new object on every poll that changes anything — typing into the spec while an agent moved the card would have been wiped. Keyed on `card.id`: opening the sheet is the moment to read the card.

### Changed
- `card-journal.tsx` exported a function called `describe`, which collides with the test runner's own — the test had to alias it on import, which was the smell. It is `describeEvent`.

## [0.38.0] - 2026-07-29

### Added
- **Link two cards by hand.** The editor gains *Part of* and *After*, each collapsed to its current value until tapped — the same inline scrolling list as the repo picker, not a nested sheet, which on a phone is a back-button trap. No client-side cycle filter: the bridge already refuses a loop with a message that says so, and reproducing that graph walk here would put one rule in two places for a mistake that is one tap to undo.
- **Reformulate asks before it replaces a hand edit.** It works from the original dictation, so it discards what you typed — right when the copilot's draft disappointed you, wrong when you just spent five minutes on the spec. `editedByHandSince()` reads the journal to tell the two apart, and the button becomes *Replace my edits?* rather than raising a browser dialog, which on a PWA is both ugly and dismissed by reflex. A restore counts as a hand edit — it is one.

### Notes
- Validated on real data rather than fixtures: pressing Reformulate on the container that started all this produced three linked sub-tasks carrying **361–612 characters of spec and 159–377 of acceptance criteria each**, where the first version of the split had emitted three bare titles. That defect, on the cards that exposed it, is closed.

## [0.37.0] - 2026-07-29

### Added
- **The journal is readable, and an overwritten spec has a Restore button.** It rendered `card.edited {"reason":"copilot",…}` in monospace — a developer's view of a database table, and nobody restores anything from that. Each entry is a sentence now; an edit expands to the text it replaced with **Restore this version** beside it. An unrecognised event type still shows raw: a journal with holes in it is worse than one with a bit of jargon.
- The replaced text is **truncated to 160 characters in the polled card response**. The journal rides `GET /api/cards/:id`, so carrying every past spec whole would grow that response without bound with the number of rewrites. A preview is enough to *decide* — you recognise your own paragraph from its opening — and `revert` restores from the row, so the whole text is what comes back. Verified end to end.

### Fixed
- The board's conditional GET had **no timeout**, while every other fetch in the app wraps its signal in `withTimeout`. The poller only fires again once the revalidator is idle, so one fetch left pending by a black-holed link — a phone waking up, a Tailscale route gone dark — would have stopped the app polling silently and for good. (e669eab)
- 0.36.0 shipped that cache with no tests at all; six now cover the tag round-trip, the 304-returns-cached-body path, per-URL keying, and the `ApiError` status that keeps a 403 reading as an auth failure.

### Changed
- The ETag cache comment no longer restates `fetchPane`'s two invariants — it points at them. Two copies of a subtle rule is one too many.

## [0.36.0] - 2026-07-29

### Added
- **Conditional GET on the two board reads that poll.** `/api/cards` and `/api/cards/:id` carry an ETag, and an unchanged poll costs a 304 with an empty body — measured on the live board: **4718 bytes → 0**, every 1.5 s, on whichever screen is open. Same client-managed scheme as the pane mirror (`cache-control: no-store` stands for privacy, so the browser keeps nothing and the client holds the `(etag, body)` pair itself), including both of that cache's invariants: the tag is stored only *with* its body, and only *after* the body parses.

### Changed
- `ApiError` is exported from `web/src/lib/api.ts`. The loaders detect an auth failure with an `instanceof` check, so the board's own fetch had to be able to raise one — a plain `Error` would have turned a 403 from the same-origin gate into a generic "can't reach the board". (bda33bb)

### Notes
- No cache-invalidation hook, deliberately: the ETag is computed from the bridge's current data, so after a write the next poll sends a stale `If-None-Match`, the server computes a different tag, and the fresh body comes back. Verified — a `PATCH` turns the next conditional GET from 304 into 200.

## [0.35.1] - 2026-07-29

### Changed
- Review of 0.35.0's own code. `waitingOn()` had been written twice, byte for byte, in `board.tsx` and `card-group.tsx` — it lives in `board-groups.ts` beside `dependencyMet()`, where both callers already look. (34fce8e)
- The status-chip class string had been copied to four call sites and had already drifted (`px-2` here, `px-1.5` there); it is a `<CardStatusChip>`, sibling to the existing `<StatusBadge>`. `children` covers the one real variation — the collapsed group summary shows a count in the same shell.
- Two route-test suites had grown identical `ctx()` and `post()` helpers; hoisted to `routeCtx()` / `actionPost()`.

## [0.35.0] - 2026-07-28

### Added
- **The board shows a split as one entry.** A container card and its sub-tasks render together, placed in the container's derived column — which is what that derivation was for. The alternative (children scattered into their own columns with a breadcrumb) loses the fact that they are one piece of work.
- **A group's collapsed state follows its column's job**, not a stored preference: open in Blocked/Review/Working/Starting/Orphaned, where you act — hiding a blocked sub-task behind a chevron would put an extra tap on the most urgent thing on the board — and closed in Backlog/Ready/Done, where five rows for one dictation is the mess this feature exists to clean up. A tap overrides it for the session.
- **A card held back by a predecessor says so on the tile** (`after "…"`, dashed, a lock instead of a status chip) and on its own page, instead of letting Start return a 409. `dependencyMet()` mirrors the bridge's gate exactly.
- `GET /api/cards/:id` resolves `parent`, `blockedBy` and `children` — the detail page holds one card, so without them it could not name what it waits on or know it is a container. Detail only: doing it in the list would be N+1 on every poll.
- Navigation both ways — a sub-task links back to the dictation it came from, a container lists its sub-tasks. (143b314)
- A container hides its branch name: it is never checked out, so naming one is a promise nothing keeps. Clearing it in the database would not be safe — a card that became a container by hand-linking may name a real worktree from before.

## [0.34.1] - 2026-07-28

### Fixed
- `reconcileParents` listed and decoded **every card on the board, archived included, on every poll tick** to answer a question about two columns. It is one narrow `SELECT parent_id, status` now. (560df7b)
- `revert` searched `listEvents`, which is capped at 100 for the card view — so a named entry older than that answered "nothing to restore" for something the user could still see. A named entry is fetched by id, and checked to belong to this card and to be an edit. (560df7b)

## [0.34.0] - 2026-07-28

### Added
- **Every overwrite of a card's written fields is journalled with what it replaced**, and `POST /api/cards/:id/revert` (optional `{eventId}`) puts one back. No version table and no undo stack — the journal is append-only, so it already *is* the history; this only reads an entry back out. Taking an event id rather than only undoing the last change is not extra code, and it beats a stack that makes you undo three things to reach the one you meant. A revert journals as an edit too, so it can be undone in turn.

### Changed
- The "what was replaced" record moved from the copilot into **`patchCard`** — the one choke point every writer routes through. In 0.33.0 it only covered the copilot's re-run, which left a hand edit through `PATCH /api/cards/:id` silently unrecoverable; one mechanism is also the only way both stay in step. Only fields that actually changed are recorded, so `startCard` patching a branch on every launch doesn't fill the journal with "nothing was edited". (90cb727)

## [0.33.0] - 2026-07-28

### Added
- **Re-running the copilot on a container now replaces its split**, instead of silently declining to touch it. That button exists *because* the split came out wrong, so refusing the split was refusing the only thing it is for. Guarded on the state that matters rather than on a flag: the old sub-tasks are replaced only while every one of them is still untouched (backlog/ready, no branch, no workspace, no session, no children of its own). One started sub-task and the whole split is kept — a card with a worktree behind it is not something a second opinion gets to delete — and `copilot.split_kept` says so in the journal. (e52a993)

### Changed
- `copilot.reformulated` now records the title, spec and acceptance it **replaced**. A re-run overwrites a spec you may have edited by hand, and the card view already renders the journal, so the previous text is one tap away rather than gone.
- `CopilotCoordinator.reformulate`'s doc claimed it "never overwrites what a human typed". It always did, and only the branch was ever held back. The comment now describes the code.

## [0.32.0] - 2026-07-28

### Added
- **A split now produces real cards, linked.** The copilot's `split_suggestion` was a list of *titles*, so a dictated note naming three tasks became three context-free stubs that had to be rewritten by hand — while the dump they came from, the only place that context existed, sat open in front of the copilot. Each entry is now a whole card (spec + acceptance), and `split` replaces `split_suggestion` (the old name still parses).
- **`card.parent_id` and `card.depends_on`** — provenance and ordering, kept apart on purpose. A card with children is a **container**: it holds the original dictation, isn't startable, and derives its status from its children (urgency first, so one blocked child outranks three that are working).
- **The dependency is a gate, never a trigger.** A card that declares a predecessor refuses to start until it is `done` and names what it waits on; a finished predecessor makes its successor start*able*, and you start it. Nothing here ever launches an agent on its own.
- **A dependent card forks from its predecessor's branch**, not from the repo's base — a serial task needs the previous one's code, not a summary of it — and its prompt says so, with the predecessor's review notes. The resolved base is persisted, so the card's diff still shows only its own work.

### Changed
- The reformulation prompt decides one-task-vs-several first, and on "several" puts *every* task in `split` with the top-level card as their container. It used to keep one task at the top level, which is how the same work ended up on two cards.
- `depends_on` is an index pointing **backward** in the split list, so a dependency cycle is unrepresentable rather than merely unlikely. Hand edits go through an explicit cycle check (`PATCH /api/cards/<id>` → 400).

### Fixed
- Node 24+ defines a `localStorage` global that stays undefined without `--localstorage-file` and shadows jsdom's, so 17 frontend tests broke the day the machine's Node was upgraded, with nothing in the repo having changed. The test setup installs a real one when it's missing.

## [0.31.0] - 2026-07-28

### Changed
- **Line wrap now defaults ON below 640px.** The pane mirror shipped with `wrap: false`, so on a phone most lines ran off the edge and reading it meant panning horizontally — measured on a real herd, panes run a median of 81 columns and a max of 233 against the ~50 a phone shows. The default follows the viewport rather than flipping globally: no-wrap is right on a wide screen, where column alignment is what makes a TUI's boxes readable. The existing toggle still wins the moment it is touched.
- The card's file-diff sheet wraps on a phone too, in pure CSS (`sm:` breakpoint), so it follows a rotation with no re-render.

## [0.30.2] - 2026-07-28

### Fixed
- An unexpected throw in a board route reached `Bun.serve` and came back as a 500 **HTML** page to a client polling JSON, with the cause visible only in `journalctl`. `handleBoardRoute` now nets those into `{ok:false, kind:"internal"}` and logs them.

### Notes
- A repository under `/tmp` is invisible to the service: the unit sets `PrivateTmp=yes`, so git fails with `ENOENT … posix_spawn 'git'` — which reads as "git is missing" when it is the working directory that is. Documented in the README.

## [0.30.1] - 2026-07-28

### Fixed
- Two GNU-only commands in the fork's own additions, both of which would have failed on macOS — a platform this plugin declares support for: `date -Iseconds` in `setup` (BSD `date` has no `-I`) and `stat -c '%a'` in the control-script tests (BSD wants `stat -f '%A'`).

## [0.30.0] - 2026-07-28

### Added
- **macOS gets the exact transcript resolution too.** `processStartedAt()` falls back from `/proc/<pid>/stat` to `ps -o etime=`, so the PID→transcript match works on both platforms Collie targets rather than degrading on one of them — macOS's `birthtime` support is native on APFS/HFS+, so giving up there for want of a start time would have been perverse. `etime` rather than `lstart`: the latter is locale-dependent (it prints `mar. juil. 28 …` here). Verified against `/proc` on the same process: 1.3 s apart.

### Fixed
- `parseEtime("-1:00")` returned 60 seconds — an empty days field parsed as 0. It matches a strict grammar now.

## [0.29.1] - 2026-07-28

### Added
- `UPSTREAM_PRS.md` — the upstream PR ledger: each generic brick with the commits that carry it, the files, and whether it is a clean cherry-pick or needs extraction. `CLAUDE.md` now requires updating it in the same commit that introduces a PR-able change.

### Fixed
- `processStartedAt()` rejects a computed start time in the future or before boot — the only way a wrong `USER_HZ` could manifest, and it now degrades to the by-directory fallback instead of returning a confident bad number.

## [0.29.0] - 2026-07-28

### Added
- **Exact transcript resolution without herdr's integration** (`bridge/proc.ts`, `TranscriptSource.resolveForProcess`). `pane.process_info` gives a pane's foreground PID, `/proc/<pid>/stat` its start time, and the session log born closest after it is that process's — measured gap on this machine: 7 s. This removes the one place the cwd fallback could be WRONG rather than merely absent: two agents live in one directory made "newest file in the folder" a coin flip, and a coin flip there means reporting another session's context. Degrades to the cwd guess with no `/proc` (macOS/Windows) or no birth times.
- **`POST /api/cards/:id/reformulate`** + a Reformulate button: hand a card back to the copilot. Creation already does this, so it covers the two cases it can't — a card written while the copilot was off, and a reformulation you didn't like.
- **Card editing** (`web/src/components/card-editor.tsx`): title, spec, acceptance criteria (as a list, not a newline blob) and base ref. Until now the only way to change a spec was to delete the card, which also threw away its sessions and journal. The branch is deliberately not editable — a worktree may exist at it.

## [0.28.0] - 2026-07-28

### Fixed
- **Every card's first prompt could be silently swallowed.** Claude Code shows a "Is this a project you trust?" dialog the first time it runs in a directory — and herdr reports `interactive_ready: true` while it is up, so there is no state to wait for. The prompt text is eaten by the select and its Enter answers the dialog: nothing typed, nothing runs, pane looks normal. **Every card gets a brand-new worktree directory**, so this hit every card. `promptAndConfirm(..., { firstAfterLaunch: true })` now verifies the agent actually started working and re-sends once.
- **The copilot never adopted its existing pane.** `ensurePane()` always created a new workspace, so after any bridge restart `agent.start` failed with `agent_name_taken` (herdr agent names are globally unique) — leaving an orphan `board` workspace behind each time. It now adopts a running agent in its work dir, or relaunches into a leftover shell.
- **The copilot swallowed every error silently.** `catch { return null }` with no output is why the two bugs above took an hour to find. Failures are logged, and a failed request drops the pane so the next one rebuilds.
- **State dir was still upstream Collie's** — `~/.local/state/collie` instead of `~/.local/state/collie-board`. A fork-rename miss (the path is built from separate segments, so the rename pass didn't match it). Move an existing one by hand: `mv ~/.local/state/collie ~/.local/state/collie-board` **with the service stopped** — a running agent caches its cwd as a string and will keep writing to the old path.

### Changed
- `Copilot` takes a snapshot accessor (for adoption) and injectable request timings (so the tests don't wait five minutes).

## [0.27.0] - 2026-07-28

### Added
- **Cold start for the repo picker**: with no cards and an empty herd the list used to be blank. The scan now falls back to conventional locations (`~/git`, `~/code`, `~/dev`, `~/src`, `~/projects`, `~/work`, `~/repos`, `~/Documents/GitHub`) when `COLLIE_BOARD_REPO_ROOTS` isn't set. Measured at 12 ms for 27 repos. Explicit config REPLACES the defaults.
- **Hide a repo** — long-press in the picker; `repo_pref` table, `POST /api/repos/hide`, `GET /api/repos?all=1`, and an "*N* hidden — show" toggle. This is the only thing the board stores about a repo, because it's the only thing it can't derive: a scan finds every repo you own and has no idea which ones you card.
- The sheet drops straight into manual path entry when nothing is found at all, instead of showing a lone "type a path instead" link.

### Fixed
- `listRepos()` reached for `homedir()` / `existsSync` internally, so its own tests found the machine's real repositories. Scan roots are resolved by the caller.
- A hidden repo no longer costs a `git symbolic-ref` to resolve a default branch that will never be shown.

## [0.26.0] - 2026-07-28

### Added
- **Repo picker on the new-card sheet** (`bridge/repos.ts`, `GET /api/repos`). Typing a path on a phone was the worst part of creating a card. The list is DERIVED, not stored: repos you have carded (`card.repo_path`, newest first) + repos open in the herd (pane `cwd` → `git rev-parse`) + an opt-in scan root (`COLLIE_BOARD_REPO_ROOTS`).
- The repo's default branch pre-fills the base ref — `origin/HEAD` first, so a repo sitting on a previous card's branch doesn't fork the next card off it.
- A card's own worktree collapses onto its source repo via `--git-common-dir`, so "start a card in another card's worktree" is never offered.
- Manual path entry stays available for a repo the bridge cannot know about.

### Notes
- No `repo` table on purpose: it would be a second copy of `card.repo_path` with nothing to invalidate it, so a moved or deleted repo would sit in the picker forever.
- `workspace.worktree.repo_root` is NOT a usable source — live-verified on herdr 0.7.5, it is populated for some workspaces and not others (one of four, all git repos). Pane `cwd` is the field that is always there.

## [0.25.1] - 2026-07-28

### Fixed
- **`start` failed with "bun not found" on a completely standard install.** Herdr runs plugin actions in a non-interactive shell, so the `~/.bun/bin` entry bun's installer adds to your shell rc doesn't apply. `resolve_bun()` now also checks `$BUN_INSTALL/bin`, `~/.bun/bin`, `/usr/local/bin` and `/opt/homebrew/bin`, and the error message names the real cause.
- `tailscale status --json | bun` ran under `pipefail`, so a tailscale that is installed but not connected killed the whole script through `set -e` instead of degrading to "unknown". Output is captured before it is piped.
- `self_dnsname` / the setup helpers called bare `bun`, so they degraded silently (empty URL, no derived config) in exactly the environment that couldn't find bun on PATH. They use the resolved path.
- `tailscale serve` failures are now diagnosed from what tailscale actually said: "serve config denied" is a permission (`sudo tailscale set --operator=$USER`), not the missing-certificate case the https branch used to blame unconditionally.

## [0.25.0] - 2026-07-28

### Added
- `collie-board-ctl.sh setup` (+ a `setup` plugin action): first-run bootstrap. Preflight (bun / herdr / socket / tailscale), links the plugin, and **derives `COLLIE_BOARD_TRUSTED_USER` and `COLLIE_BOARD_PUBLIC_HOSTS` from `tailscale status`** — the two security settings people skip. Detects a tailnet with no HTTPS certificate and writes the `SERVE_MODE=http` fallback instead of letting `serve` fail.
- Refuses to touch an existing `.env`: it reports what's missing and prints the exact lines. Starts nothing, publishes nothing.

## [0.24.0] - 2026-07-28

### Added
- **Agent adapters** (`bridge/adapters.ts`, `adapters/agents.toml`): the four points where agents diverge — launch kind, context-reset command, whether the transcript is readable, whether a native session id is reported. Merged per FIELD from `~/.config/collie-board/agents.toml`, so overriding one line doesn't restate the table.
- The context tracker skips agents whose transcript format isn't readable (level 3 by construction), and the copilot takes its reset command from the table.
- `UPSTREAM.md` — what is PR-able, what is fork-only, and the (short) list of upstream files this fork touches.
- README: a board section with configuration, endpoints and what is deliberately not built. `ARCHITECTURE.md` §9 and the fork's rules in `CLAUDE.md`.

## [0.23.0] - 2026-07-28

### Added
- **Copilot** (`bridge/copilot.ts`) — one long-lived agent in a dedicated `board` workspace, driven through the same `agent.prompt` the cards use. No API key, no SDK; the session is openable in the TUI when an answer goes wrong.
- Output contract is a FILE, never terminal scraping: each prompt ends with "write the JSON to `.board/out/<id>.json`", and the file appearing is the completion signal.
- **Reformulation** — a dictated brain dump becomes title + spec + acceptance criteria + branch name, in the background (creating a card stays instant). `split_suggestion` becomes extra backlog cards.
- **Post-`done` review** — verdict + notes + todos from `git diff --stat` and the handoff note, never the full diff. The todos become cards, which is what refills the board from what agents left undone.
- Serialised to one request at a time (one pane is one queue), `/clear` every 8 requests, and **off by default**: `COLLIE_BOARD_COPILOT=on`. Also `COLLIE_BOARD_COPILOT_KIND`, `COLLIE_BOARD_COPILOT_CLEAR`.

### Fixed
- `launchAgent()` is now the single path for starting an agent (retry on `agent_pane_busy`, then wait for `interactive_ready`). Calling `agent.start` directly is how you get a pane with a shell prompt and no agent in it — which is exactly what the copilot did on its first run.

## [0.22.0] - 2026-07-28

### Added
- **Handoff** (`bridge/handoff.ts`, `POST /api/cards/:id/handoff`): the outgoing agent writes `.board/handoff.md`, the pane is replaced in the SAME workspace (same worktree, same branch), and the incoming agent opens on the note plus the original spec. Sessions chain on the card.
- Asynchronous by design — the request only prompts; the poll loop completes the swap once the note lands. The marker is a database column (`session.handoff_requested_at`), so a pending handoff survives a bridge restart.
- Additive schema migrations in `BoardDb.migrate()`.
- PWA: Hand-off button (prominent past `COLLIE_BOARD_HANDOFF_PCT`), pending state, and each session's note readable inline on the card.

### Fixed
- **`agent.prompt` does not reliably submit.** Live-verified on herdr 0.7.5: a multi-line prompt lands in Claude Code's box as `[Pasted text #N]` and just sits there; one `Enter` afterwards submits it untouched. `promptAndConfirm()` now checks the agent actually started working and nudges with `Enter` when it didn't — the same "read it back and look" rule Collie already applies to replies.
- `.board/` is excluded from a card's diff — it's board plumbing, not the card's work.

## [0.21.0] - 2026-07-28

### Added
- **Card diff** (`bridge/git.ts`, `GET /api/cards/:id/diff?mode=stat|file&path=`): the card's checkout against its fork point, so committed AND uncommitted work show up, plus untracked files (which `git diff` cannot see). `--stat` first on mobile, tap for the unified patch.
- **Context gauge** (`bridge/context.ts`, `latestUsage()` in `bridge/transcript.ts`): input + cache_creation + cache_read of the newest non-sidechain assistant turn, refreshed per pane every 30 s off the existing poll.
- The gauge is pushed to herdr with `pane.report_metadata`, so it renders as `$ctx` in the TUI's Agents sidebar too. TTL'd (90 s) so a stopped bridge leaves no stale figure.
- `TranscriptSource.resolveByCwd()` — finds an agent's log from the directory it was launched in, for the (default) case where herdr reports no `agent_session`.
- Config: `COLLIE_BOARD_CTX_WINDOW` (default 200000; set 1000000 for a 1M-context model).

### Notes
- Level 2 of the telemetry design (a transitions/output heuristic) is **deliberately not built** — see the header of `bridge/context.ts`. Level 3 (no gauge, Handoff always available) is the degradation.
- herdr reports `agent_session` only once `herdr integration install claude` has run; without it, Collie's own pane History is unavailable too. The gauge works either way thanks to the cwd fallback.

## [0.20.0] - 2026-07-28

### Added
- **Start a card from the phone**: `POST /api/cards/:id/start` runs `worktree.create` → `agent.start` → readiness poll → `agent.prompt` (spec + acceptance criteria) and opens a session. 1 card = 1 branch = 1 workspace.
- `POST /api/cards/:id/prompt` — a follow-up instruction to the card's running agent.
- Concurrency semaphore (`COLLIE_BOARD_MAX_AGENTS`, default 3), counted from the database so a restart doesn't forget.
- Config: `COLLIE_BOARD_AGENT_KIND`, `COLLIE_BOARD_MAX_AGENTS`, `COLLIE_BOARD_BRANCH_PREFIX`, `COLLIE_BOARD_HANDOFF_PCT`.
- PWA: Start / Relaunch button and a prompt box on the card page.

### Fixed
- `bridge/herdr-client.ts`: per-request timeout, so `agent.start` isn't judged by the 5 s RPC budget.

### Notes — herdr 0.7.5, live-probed 2026-07-28
- `agent.start` does **not** wait for readiness (returns in ~2 ms, `launch_pending: true`); prompting in that window fails `agent_not_ready`. The bridge polls `agent.get` for `interactive_ready` instead.
- `agent.start` right after `worktree.create` fails `agent_pane_busy` while the shell sources its rc — retried, and only on that code.
- `agent.start` names must match `^[a-z][a-z0-9_-]{0,31}$`, so a branch name can't be used as-is.
- `worktree.create` reuses an existing BRANCH, but fails if the checkout DIRECTORY exists; `worktree.open` is idempotent and returns `already_open` — that pair is the relaunch path.

## [0.19.0] - 2026-07-28

### Added
- **Cards** — a durable board on top of the ephemeral herd: `bridge/db.ts` (bun:sqlite, raw SQL, no ORM), `bridge/cards.ts`, `bridge/board-routes.ts`.
- Card reconciliation rides the existing `session.snapshot` poll: a pane that vanishes moves its card to `orphaned` (never an error) and closes its session as `lost`; a live pane drives the card's column from `agent_status`.
- REST: `GET/POST /api/cards`, `GET/PATCH/DELETE /api/cards/:id`, `GET /api/cards/:id/{sessions,events}` — all behind the existing `guard()`, all audited.
- PWA: `/board` (columns, urgency first) and `/card/:id` (spec, acceptance, session chain, journal), plus a Board row on the dashboard.

## [0.18.0] - 2026-07-28

### Changed
- Forked upstream Collie as **Collie Board**: plugin id `herdr.collie-board`, systemd unit `collie-board`, env prefix `COLLIE_BOARD_*`, default port 8788, config/state dirs `~/.config/collie-board` / `~/.local/state/collie-board`, control script `scripts/collie-board-ctl.sh` — so both plugins can be installed on one machine.
- Upstream release check is opt-in via `COLLIE_BOARD_UPDATE_REPO`; the local `bridgeStale` detector is unchanged.
- `LICENSE` keeps Collie's MIT copyright and adds the fork's.

## [0.17.0] - 2026-07-27

### Fixed
- **A reply sent while an agent dialog was focused answered the dialog instead.** The submit key approved whatever option was highlighted (Claude defaults to "Yes") and the message was destroyed, while the bridge reported success. Sending now refuses outright while a dialog is up, and otherwise types first and only submits once the text is verified in the input box (#34) — thanks @maikschuheida-spec

### Changed
- Free-text replies on harnesses with a block grammar (Claude) are two steps — type, verify, submit — so "Sent ✓" now means the text was seen in the input box. Harnesses without an adapter keep the previous one-shot send

## [0.16.1] - 2026-07-27

### Fixed
- `/api/config` is now gated like every other endpoint — it was the one route that skipped the same-origin check and `COLLIE_PUBLIC_HOSTS`, noted by @Optic00 in #32 (a54afd9)

## [0.16.0] - 2026-07-27

### Added
- Bring-your-own-tunnel deployment path documented as **Variant E** — NetBird, ZeroTier, Cloudflare Tunnel (6550041)
- `scripts/collie-ctl.test.sh` — first lifecycle coverage for the control script, wired into the pre-push hook (a004449, 65889da)

### Fixed
- `unserve`/`uninstall` no longer remove a `tailscale serve` mapping Collie didn't create, and `start` no longer replaces one (a004449, thanks @iamtimmy)
- A front door that fails to publish no longer aborts `start` before the status banner (65889da)

## [0.15.0] - 2026-07-26

### Added
- Pane conversation history read from the agent's own transcript — scroll back past the live mirror (77dff7c)
- Windows support for the bridge: dials herdr's named pipe through `node:net`, one code path for both platforms (#25, #27) — thanks @mikebenner and @bwright2810 (dd6610d)
- `COLLIE_HERDR_DIAL=auto|net|bun` forces the dialer; `net` exercises the Windows path on Linux/macOS (f662834)

### Changed
- **Breaking, only if `COLLIE_DEVICE_HEADER` is set:** a request arriving *without* the device header is now read-only. It previously got full write access, which let any tailnet client reach the bridge's own URL and skip the proxy that injects the header. Front doors that inject it on every request are unaffected; direct loopback/MagicDNS access now needs the header sent by hand (#28) — thanks @Optic00 (8ed715d)

### Fixed
- A 401/403 no longer renders as an endless "reconnecting" banner — an access refusal now says so and offers Reload (#30) — thanks @Optic00 (7bdcbfb)

## [0.14.2] - 2026-07-23

### Added
- Paste an image straight from the clipboard into the composer, same upload path as the picker (#24) (ad6957b)

## [0.14.1] - 2026-07-22

### Fixed
- `collie-ctl.sh self_dnsname` shelled out to `node`, which Collie never requires — now uses `bun` (#22) — thanks @jz-wilson (a61f3d1)

## [0.14.0] - 2026-07-21

### Added
- Alt modifier in the nav tray — `alt+<key>` chords now reachable from the phone (#19) — thanks @bnivanov (d1dc947)
- Modifiers combine (checkbox, not radio): `ctrl+shift+p`, `alt+shift+p`, even triple chords (#20) (d1dc947)
- Modifier lock — tap an armed modifier again to keep it armed across presses and Sends; Clear or a third tap releases (#20) (d1dc947)

### Changed
- HERDR_API.md: multi-modifier chords live-verified in any order against Herdr 0.7.3, cross-confirmed on 0.7.4 by @bnivanov (b505c4e)

## [0.13.2] - 2026-07-20

### Fixed
- Tabs render in Herdr's reported order instead of stable-number order, so a reorder in Herdr survives to the screen — thanks @iFwu (a16478f)
- Tapping raw terminal output focuses the composer synchronously, keeping iOS's user-activation window so the software keyboard opens — thanks @iFwu (a78ccfd)

## [0.13.1] - 2026-07-20

### Fixed
- Taking over or sending a draft no longer permanently mutes the preview for that same text — the handled key resets once the host line clears (7153639)
- Send's pre-clear sweep overshoot widened 8 → 32 so host typing inside the poll gap can't leave a remnant (7153639)
- A scrollback line starting with `❯` can no longer pin a bogus session name — only the live (bottommost) prompt decides (808cce7)

## [0.13.0] - 2026-07-19

### Added
- Long-press a pane pill for a pane actions sheet — rename + two-tap close (5b50941, c713551, 90210ce, ea20df0)
- Pane rename end-to-end: `pane.rename` RPC, bridge route, label threading (99c8808)
- Tab rename + tab close (blast-radius confirm) via the same long-press sheet on tab chips (a9664b5, 37a470e)
- Claude's own `/rename` session name surfaced on cards, headers, and the switcher (d22fdd7)
- Read-only "Draft in terminal" preview with explicit Take over — the composer input is exclusively phone-owned (4b6f0ac, 10fa28d)
- Self-update without the service worker: `X-Collie-Build` on polled responses, auto-reload or tap-to-update banner (8d13622)
- Instant offline navigation — during a known outage, routes serve the last good snapshot instead of hanging on a dead fetch (b756edd)
- Busy strip on genuinely hung loads: navigations >500ms, background polls >6s (e886541, 3bfaa1c, 06516c4)
- `-dev` marker in the build stamp for non-release builds (3e785f4)

### Changed
- One shared `AppHeader` for dashboard, space, and pane — same components underneath, stale status badges dim during outages (29432c2)
- Connection status is a single animated top bar — amber "reconnecting…" after 4s of trouble, red with Retry at 15s, green flash on recovery; no header pill (394e6fe, b2dd50e)
- Switcher sections carry status-colored bullets; per-row close removed (switching is the only action there) (3918c69)
- `assets/*` served immutable, everything else `no-cache` — proxy caches can no longer starve `/sw.js` updates (8d13622)

### Fixed
- Own in-flight reply no longer flagged as a stranded terminal draft (e8462f9)
- Wrapped multi-line drafts and the new background-agents footer no longer break input-box detection (829fc7e, d9521e3)
- `navigator.onLine` never gates polling or liveness — lying flags can't wedge the app or fake outages (d31ffb8, 394e6fe)
- One shared connection-lost clock; escalation survives route changes and app switches until a poll succeeds (1486e07, 5949885)
- Sustained outages escalate everywhere — boot splash, header, banner — with Retry/Reload (0cbbac1, 4d89588, 4494cf5)
- Gallop sprite re-centered; the dog never freezes mid-stride (rest state is the static icon) (3c7174a, 394e6fe)
- Offline banner no longer overlaps the sticky header (bf98a88)

## [0.12.0] - 2026-07-17

### Added
- `COLLIE_SKIP_SERVE=1` env var to disable tailscale serve entirely — bridge stays on loopback only, ideal for deployments behind a reverse proxy (Caddy, Nginx, etc.) — thanks @diogenesc (ad5833a)
- `COLLIE_PUBLIC_URL` — `collie-ctl.sh status` banner shows your real reverse-proxy URL instead of a placeholder (4b043be)
- Bridge startup warning when `COLLIE_TRUSTED_USER` is set under `COLLIE_SKIP_SERVE=1` — the identity gate is inert without tailscale serve injecting `Tailscale-User-Login`; use `COLLIE_DEVICE_HEADER` (4b043be)
- README Variant C — reverse proxy as the only front door (no Tailscale), with Caddy example and required env (76019f7)

### Changed
- `collie-ctl.sh unserve`/`uninstall` always attempt serve teardown, even under `COLLIE_SKIP_SERVE=1` — a stale mapping from before the flag flip would keep publishing the app (4b043be)
- Security posture docs: "tailscale serve is the sole ingress" → "exactly one hardened front door" (tailscale serve or a conforming reverse proxy) across README, ARCHITECTURE, CLAUDE.md (76019f7)

## [0.11.1] - 2026-07-16

### Fixed
- Opening a tab/pane lands on the live tail — terminal `<pre>` no longer steals vertical scroll from the message list; stickiness also re-pins when content grows (04bf6fc)

## [0.11.0] - 2026-07-15

### Added
- Pluggable harness-adapter architecture: a `HarnessAdapter` registry replaces the single Claude-only gate, Claude's detectors move to `lib/harness/claude/`, and a core race-guard engine (`lib/harness/guard.ts`) is the only module that may touch the network — an import fence (enforced by `fence.test.ts` under `bun run test`) + a conformance suite let contributors add codex/pi/opencode (see `HARNESS_CONTRIBUTING.md`)
- multiSelect AskUserQuestion support: checkbox options up-level to tappable checkbox rows (terminal is source of truth), with a closed-loop Submit that navigates the pointer to Submit and verifies before Enter (never blind-sends), plus the review/confirm screen
- Prompt overlay: interactive prompts render in a bordered `bg-card` panel that lifts the whole dialog off the terminal mirror, with elevated option rows, leading key-digit badges, and a family-aware caption
- Update notifications: a footer banner (linking to the GitHub release) and an opt-out web-push when a newer release is published upstream or the running bridge is behind the on-disk code — checks the repo's tags over anonymous HTTPS, stamps its own sources for the restart signal, a Settings "check for updates" button forces an immediate check, an `updates` notify pref is the off-switch, and update/restart are surfaced as location-independent Herdr plugin actions

### Changed
- Keys and Quick menus dock in-flow above the controls row instead of a fixed overlay, so the terminal mirror shrinks and re-pins to the bottom (ResizeObserver) — the prompt/cursor stays visible; both buttons are toggles
- Prompt option rows compacted (tighter padding, snug line-height) so a multi-option dialog fits the phone viewport
- "Sent" status toast moved from a bottom overlay (which covered the terminal tail) to a slim in-flow row below the header
- Build stamp marks a dirty working tree (`<sha>-dirty`), so the footer no longer claims HEAD when the build carries uncommitted work
- multiSelect Submit is ~2s instead of ~15s: the pointer walk re-reads the actual position each step and stops on "Submit", instead of polling for the bottom row after every key (which timed out ~2.8s per step)

### Fixed
- Prompt-select + wizard grammars: a numbered list in a dialog body (e.g. a plan's steps) no longer breaks menu detection — the menu is taken as the trailing `1..m` run, so plan-approval prompts up-level correctly

## [0.10.3] - 2026-07-12

### Fixed
- `collie-ctl.sh build` installs the root dependency tree (not just `web/`) before typechecking, so a fresh Herdr install no longer fails with TS2688 "Cannot find type definition file for 'bun'" (03f409f, #9)

## [0.10.2] - 2026-07-12

### Fixed
- Composer Send clears a stranded draft off the terminal `❯` line (ctrl+k + Backspace) before typing so replies no longer accumulate on the prompt; a clean prompt skips the clear (cd1cc25)
- Bridge settles ~350ms between typing and Enter so the TUI reliably accepts the submit key (cd1cc25)

## [0.10.1] - 2026-07-11

### Fixed
- Terminal mirror defaults to no-wrap for table alignment like desktop Herdr; clearer borders/typography (font 12, muted-foreground box-drawing); pane stays viewport-width — toggle Wrap on in View for prose (85f777b)

## [0.10.0] - 2026-07-10

### Added
- Herdr session switcher: one bridge fronts every named herdr session — `?session=` on the API, `?s=` in the app, a sessions summary in the snapshot, per-session notification slots, and a `COLLIE_MULTI_SESSION` kill-switch (8fa1f20)
- Space detail is a deep-linkable route (`/space/:spaceId`) with a working browser Back button, replacing the in-home drill-in state (0e5f9c8)
- Terminal-draft recovery: a queued-then-recalled message stranded on the "❯" input line surfaces as a composer chip, with "Edit here" to clear the line and adopt the text cleanly (46dcf35)

### Changed
- Dashboard leads with "Needs you" — agents awaiting your input sit at the top, above the spaces overview (1d92592)
- Dashboard, space, and settings scroll inside a viewport-clipped region instead of the whole document (2aa9272)
- Session switcher and the session chip are dashboard-only, keeping the in-space and pane headers clean (bb0048d, ba56ba9)
- Header polish: consistent compact height across the dashboard and inside a space, zinc-800 nav chrome, a ringed Collie mark, a smaller pane-header agent logo, and the keyboard-only quick-keys strip removed (6250e0c, 9da7195, 35db0e5, ba56ba9)
- Security posture documents that `COLLIE_MULTI_SESSION` (default on) fronts every named session under the config root (fcb0b7d)

### Fixed
- Deep-linking a space that never existed shows "Space not found" rather than "Space closed" (fcb0b7d)

## [0.9.1] - 2026-07-09

### Security
- Removed one-tap yes/no reply buttons from push notifications — they POSTed to the terminal without opening the app, i.e. approving blind. Notifications now only deep-link to the pane (cb26ee0)

## [0.9.0] - 2026-07-07

### Changed
- Quick keys mimic a physical keyboard on both surfaces: Esc top-left, Tab below it, inverted-T arrows, Enter top-right; Keys sheet gains a full-width spacebar (2f70662)
- Attach image lives in the reply row (usable without the phone keyboard open); digits leave the inline strip — the 123 tab remains (2f70662)
- Header collie logo is transparent like the gallop sprite — removed favicon.svg's baked-in gray backing rect (3f05da8)

## [0.8.0] - 2026-07-07

### Added
- Poll herdr 0.7.2's `session.snapshot` — one RPC per tick instead of three list calls; permanent fallback to the list trio on older servers (5687bbf)
- Event-poked polling: `events.subscribe` stream triggers immediate debounced re-polls; interval relaxes to `COLLIE_POLL_IDLE_MS` (default 12s) while the stream is healthy (5687bbf)

### Changed
- HERDR_API.md re-verified against herdr 0.7.2 / protocol 16; terminal observe/control filed under ARCHITECTURE.md Future ideas (aad94b3)

## [0.7.0] - 2026-07-06

### Added
- Notification type prefs: Settings "Notify when" toggles per agent status, bridge-wide; default pushes only "Needs input" (blocked) — "Finished" (done) is off (98cf5d2)

### Changed
- Push sends carry a `collie-herd` topic + 6h TTL: an offline device now gets one current summary on reconnect instead of replaying every queued update (98cf5d2)
- Disabling a notification kind retracts its pending/outstanding alerts immediately (98cf5d2)

## [0.6.0] - 2026-07-06

### Added
- First-paint PWA splash: the galloping collie shows before React mounts (299f632)
- Keys sheet: `Ctrl` modifier + visible key queue — compose chords/sequences, review, Send as one call; dialer-size digits on a `123` tab (515f795)

### Changed
- Header Collie mark matches the agent logo (2rem, aligned across screens); Find lives in the composer View row; placeholder is just "Type a reply…" (11385ee)

### Fixed
- Option taps no longer pop the phone keyboard or steal the note editor's focus (11385ee)
- Stalled connections no longer zombify the app: fetch timeouts (10s/20s/60s), polls supersede a wedged revalidation at 12s, and the collie gallops within 2.5s of a stalled load or pane-tap navigation (e6ad939)

## [0.5.0] - 2026-07-05

### Added
- **Preview-variant question notes.** Claude Code's *preview* AskUserQuestion — a single-select
  question whose options carry a `preview` field (the mockup/snippet pane, footer hint
  `n to add notes`) — is lifted into a native block that surfaces the per-question note affordance.
  A note (attach / edit / remove) is driven from the native option UI and applies **per question**,
  not per option row. Delivery uses the verified staged keystroke choreography
  (`n` → confirm the input focused → clear → paste the text via the reply path → `Escape` to blur,
  each stage verified rendered before the next fires; `Enter` is never sent, since it would submit
  the dialog — see `web/src/lib/grammar/NOTES_NOTES.md`), and option selection is the two-step
  digit → verify-pointer → `Enter` recipe. Race-guarded like the other dialog blocks (a stale tap on
  a drifted dialog aborts before anything irreversible is sent). Claude-scoped (`hasBlockGrammar`)
  and web-only; the standard non-preview select and wizard steps are unaffected (pressing `n` there
  is a no-op, so no notes UI is shown).

### Security
- **Preview-note tap guard hardened to region-signature parity.** The preview dialog's race guard now
  carries a pointer- and note-independent **core signature** (the subject/question/stepper above the
  options joined with the option rows' left column, `❯` normalised) — matching the 0.4.0 `signature`
  parity the prompt/wizard guards already had. It is enforced at entry AND on **every** mid-flight
  acceptance/drift check, so a same-shaped successor dialog (identical question + labels, different
  subject) can no longer be answered by a stale tap: no digit-then-`Enter` or `Enter` is sent unless
  the fresh read's core signature byte-matches what the user saw. The blur poll is now three-valued
  (ok / drifted / timeout) so the Escape-retry fires only on a genuine swallowed key — never after the
  dialog drifted or vanished (which a blind second Escape could cancel / interrupt). Pasted note text
  is stripped of C0/C1 control bytes (ESC, BEL, …) before it can reach the focused input.

## [0.4.0] - 2026-07-05

### Added
- **Block-based terminal renderer.** Pane rendering now flows through a semantic Block AST (styled
  lines → typed blocks → React components) instead of a flat span mirror. The raw-block foundation is
  byte-for-byte identical to the old mirror, but it's the seam every feature below builds on —
  detected regions are lifted into native blocks in place, and anything unrecognized falls back to
  the raw mirror. Scoped to Claude Code (`hasBlockGrammar`); every other agent renders the plain
  mirror, since their TUIs are unverified.
- **Native prompt buttons.** A Claude single-choice dialog at the buffer tail (select, permission,
  trust, plan approval) is lifted out of the mirror and rendered as tappable buttons; a tap sends the
  per-family keystrokes (digit, or digit+Enter for AskUserQuestion), guarded so a stale tap on a
  scrolled-up menu can't fire. The agent's own input box/statusline are stripped so they don't
  duplicate the composer.
- **Status strip.** The stripped statusline (model · ctx% · cwd · branch · tokens) is re-surfaced as
  a slim line above the composer, so the branch/context stays visible instead of vanishing with the
  input-box chrome.
- **Submission progress bar.** A slim indeterminate bar across the top of the app while any mutation
  (reply, keys, prompt tap, upload, tab/space create, close, snooze) is in flight; background polling
  never triggers it, and a 120ms delay means a fast action never flashes it.
- **Raw-terminal escape hatch.** A View toggle (terminal icon) that turns off the block renderer —
  native prompt buttons, chrome stripping, status strip — and shows the plain mirror, so a
  mis-detected/mis-rendered dialog can always be driven by hand with the keys pad. Persisted.
- **Multi-question wizard.** A multi-question AskUserQuestion (the `☒ Focus area ☐ Scope ✔ Submit`
  stepper) now renders as a native step-by-step wizard instead of bailing to the raw mirror: the
  stepper chips (answered/current per question), the current question's options as tappable buttons
  (one digit each — verified: a wizard digit instant-selects and advances), back/next step
  navigation, and the final Submit review step (answers echoed, submit/cancel). Incremental
  round-trip: every tap is a single race-guarded keystroke re-derived against a fresh read; the TUI
  stays the source of truth. Choreography + fixtures documented in
  `web/src/lib/grammar/WIZARD_NOTES.md`.
- **Galloping Collie loader.** The mascot now doubles as the app's activity indicator: a 6-frame
  gallop sprite (`web/public/dog-gallop.png`, a 768×128 transparent strip) stepped through with a
  pure-CSS `steps(6)` animation (no JS timers). At rest it's the familiar static app icon
  (`favicon.svg`); it springs into the gallop on the boot splash while the first snapshot loads and
  whenever the connection isn't live (connecting / reconnecting / offline), settling back to the
  static icon once live. Honours `prefers-reduced-motion`. New `DogGallop` component; rough
  first-pass art to be replaced with higher-quality frames.

### Changed
- **One consistent top-left mark on every screen.** The Collie is now the brand + home button +
  connection loader in a single shared `CollieHome` component, rendered identically on the dashboard
  and inside a pane — so the header's top-left always means the same thing (previously a "stacks"
  icon inside a pane vs. the Collie logo on the dashboard). Inside a pane the Collie gallops on
  reconnect from the same global connection state as the dashboard (shared `isConnecting` predicate).

### Removed
- **The pane's Nav-hub drawer** (the left "stacks" drawer). It was redundant now that the Collie
  handles Home, the swipe-up switcher already covers pane switching/closing, and the breadcrumb
  covers cross-space jumps — removed along with its `SpaceList` component. The swipe-up switcher now
  appears whenever a pane is open, so even the last pane stays closable.

### Fixed
- **Multi-question AskUserQuestion no longer mis-parsed.** A multi-step AskUserQuestion (the
  `☒ Focus area  ☐ Scope  ✔ Submit` stepper) was detected as a single-question select and answered
  with one digit+Enter — submitting a half-filled form. It's now recognized as a wizard and left as
  the raw mirror (drive it with the keys pad, or via the new escape hatch) rather than mis-sending.

### Security
- **Prompt/wizard taps are guarded against same-shaped successor dialogs.** The tap race guard now
  compares a byte-signature of the whole dialog region — including the subject above the options (the
  diff/command being approved), not just the question and option labels. So a tap on a frozen mirror
  can no longer approve a *different* action that happens to render an identical-looking prompt (e.g.
  a second edit to the same file after the first was answered elsewhere). Herdr's `revision` is a
  stub, so this content signature is the load-bearing freshness check.

## [0.3.0] - 2026-07-03

A full-codebase review pass: four audit agents (backend, frontend, security, ops/product) swept the
tree; everything they found was verified, fixed, and the top feature gaps were built.

### Added
- **Reply from the notification.** Needs-you pushes now carry up to two quick-reply action buttons
  (agent-aware: codex gets `yes`/`no`, others `yes`/`continue`; bridge sends `quickReplies` in the
  payload). Tapping one POSTs the reply straight from the service worker and confirms with a silent
  "Sent ✓" — no app open needed. Body tap still deep-links as before.
- **Find in output.** A magnifier in the pane header opens a find bar: case-insensitive match over
  the visible buffer, match count, prev/next that cooperates with the scroll-freeze, highlights
  rendered through the same React-text-node path (XSS boundary untouched).
- **Load older scrollback.** A "load older" row at the top of the mirror grows the fetched window
  600 lines at a time (up to 5000; the bridge clamps reads at 10000), preserving your scroll
  position across the refetch.
- **Destructive-input confirm.** Replies matching a reviewed pattern list (`rm -rf`, `sudo`,
  `git push --force`, `dd if=`, `mkfs`, redirects to system paths, …) flip Send into a two-tap
  "Really send?" state for ~3s — same pattern the `/clear` palette action already used.
- **Audit log.** Every write action (reply, keys, upload, tab/workspace create, pane close) appends
  a single JSONL line — timestamp, action, pane, device, truncated params — to
  `<state-dir>/audit.log` (mode 0600). Audit failures never block the action itself.
- `COLLIE_PUBLIC_HOSTS` env var — an explicit Host-header allowlist. When set, requests addressed
  to any other Host are rejected before origin logic, defeating DNS rebinding. Strongly
  recommended (set it to your MagicDNS name); effectively mandatory with `COLLIE_SERVE_MODE=http`.
- Startup warnings when `COLLIE_TRUSTED_USER` or `COLLIE_PUBLIC_HOSTS` is unset — parity with the
  existing bind/allowlist warnings, since an empty trusted-user means any tailnet device has write
  access.
- Uploaded images are now swept after 48h (was: kept forever).

### Changed
- **Builds are gated.** `bun run build` (root) and `collie-ctl.sh build` now typecheck bridge and
  web before building, and build into `dist-staging` with an atomic swap — a failed build can no
  longer leave an empty `web/dist` serving 503s. The pre-push hook typechecks both sides too
  (`SKIP_TYPECHECK=1` to bypass once). Root tsconfig now enforces `noUnusedLocals/Parameters`.
- **Write requests without an `Origin` header are rejected** unless they arrive on loopback
  (browsers always send Origin on POST; curl-on-host keeps working).
- Idle lock is now timestamp-based: backgrounding/foregrounding the app no longer resets the
  countdown, and returning past the deadline locks immediately.
- The composer moved into its own `<Composer>` component; `agent-chat.tsx` slimmed by ~230 lines.
- A reply whose text lands but whose submit keystroke fails now reports "typed into the pane but
  not submitted — check the pane before resending" (and `textDelivered: true`) instead of a generic
  error that invited double-sends.
- systemd unit hardened (`NoNewPrivileges`, `PrivateTmp`) and made persistent
  (`StartLimitIntervalSec=0`, `RestartSec=5`) so a crash-loop can't leave the service permanently
  down while you're phone-only.
- Notification deep links URL-encode the pane id; sheets manage focus (focus in on open, restore on
  close, `aria-labelledby`); space status dots gained screen-reader text; pinch-zoom re-enabled
  (removed `maximum-scale=1`).

### Fixed
- **Socket leak on RPC timeout** — a stalled Herdr left the Unix-socket FD open on every timed-out
  request; under the 1.5s poll cadence this exhausted file descriptors and wedged the bridge. Every
  terminal path now closes the socket.
- **UTF-8 corruption across socket chunks** — multi-byte characters (box drawing, emoji) straddling
  a socket-read boundary rendered as `�`; replies are now stream-decoded.
- **Overlapping polls** — a slow Herdr let 1.5s ticks pile up 3-4 concurrent polls; a tick is now
  skipped while the previous poll is in flight.
- **Upload buffering** — a too-large upload was buffered fully into RAM before the 10MB check;
  oversized `Content-Length` is now rejected up front and `Bun.serve` caps request bodies at 12MB.
- Push subscription saves are serialized and written atomically (temp+rename); concurrent
  add/prune can no longer drop a subscription. State files are written 0600 in 0700 dirs.
- First PWA load no longer flashes an immediate reload (service-worker `controllerchange` on
  initial claim was treated as an update).
- A rotated VAPID key now unsubscribes the stale push subscription and re-subscribes fresh instead
  of silently dead-ending pushes.
- Superseded loader revalidations are aborted (`request.signal` threaded through); raw key presses
  debounce their revalidate (one refetch per burst instead of one per keystroke).
- Slash-command insert appends to the draft instead of overwriting it; tap-to-focus no longer
  collapses an active text selection (copying pane output works now).
- `envInt` config parsing rejects garbage and out-of-range values (negative poll/debounce
  intervals, invalid ports) with a warning instead of silently accepting them.
- Static-file path guard now checks the directory boundary (`dist` vs `dist-*`); `?lines=` is
  clamped; API/static responses carry `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`; graceful shutdown drains in-flight requests.
- Pre-commit version guard now also covers `web/vite.config.ts`, `web/index.html`,
  `web/package.json`, `web/public/`, `systemd/`, and root `package.json`, and requires the new
  version to sort strictly above the old one.

## [0.2.0] - 2026-06-30

### Changed
- **Smarter push notifications.** A blocked/done alert is no longer fire-and-forget. Each one now
  waits a short **debounce window** (`COLLIE_NOTIFY_DELAY_MS`, default 30s) before it sends; an agent
  you clear at your desk within that window never reaches your phone. Alerts that *do* fire are
  **retracted** automatically once the agent resolves (or its pane closes), so handled work stops
  piling up on your lock screen. The service worker also **suppresses** the system notification when a
  Collie tab is already open and visible (the in-app status surfaces it instead).
- **Coalesced into one notification.** The whole herd shares a single notification slot: one agent
  shows the named, deep-linked alert; several collapse into a *"N agents need you"* digest (tap → the
  triage home) that updates in place as agents come and go, instead of stacking N separate alerts.

### Added
- **Do Not Disturb / snooze** (Settings → *Do not disturb*): pause all push for 30m / 1h / 4h, or
  resume early. Server-enforced and self-expiring, so it quiets every device — and it clears whatever
  is already on the lock screen the moment you snooze. The current deadline rides the snapshot, so it
  stays in sync across devices.
- `COLLIE_NOTIFY_DELAY_MS` env var — the push debounce window in ms (default `30000`; `0` notifies on
  the next tick with no debounce).
- `POST /api/notifications/snooze` — set/clear the global snooze (`{ snoozedUntil: number | null }`);
  the active deadline is reported on the snapshot as `notifications.snoozedUntil`.

## [0.1.0] - 2026-06-30

Initial public release of **Collie** — a phone web UI to monitor and reply to your Herdr agent
herd over Tailscale.

### Added
- **Mobile-first PWA** (Vite + React + TypeScript + Tailwind v4 + shadcn): a triage dashboard
  (Spaces overview + Needs-you / Working / Idle agent groups), a per-agent colored terminal mirror,
  an agent-aware slash-command palette (Claude Code, Codex, pi, opencode), a special-keys pad with
  inline arrows/Tab, per-agent brand icons, image upload, and animated view transitions. Installable,
  with an auto-updating service worker and a build-stamp footer.
- **Bun/TypeScript bridge** over Herdr's Unix socket: a polled live snapshot (adaptive cadence,
  gzip + `ETag`/`304`) plus reply / keys / upload endpoints, and space/tab/pane management (create
  shell panes, switch, kill) through a unified nav hub.
- **Runs as a `systemd --user` service** supervised independently of Herdr, with a `tailscale serve`
  launcher (`scripts/collie-ctl.sh`) and a thin Herdr plugin (`herdr.collie`) exposing
  start / stop / restart / status / url / version / update / uninstall actions. One-command update
  (pull → rebuild → restart → re-link) for the linked checkout.
- **Optional Web Push (VAPID) notifications** when an agent needs you, with a custom service-worker
  push handler that renders the real message and deep-links the tap to the agent's pane.
- **Security posture:** loopback-only bind, `tailscale serve` as the sole ingress (never `funnel`),
  a same-origin gate, an optional `COLLIE_TRUSTED_USER` identity check, optional per-device
  authorisation via a trusted upstream header, a strict CSP, and terminal output rendered as React
  text nodes (the XSS boundary).
