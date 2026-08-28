# Upstream PR ledger

The work in this fork that belongs to [`AltanS/collie`](https://github.com/AltanS/collie) rather
than to the board, with the commits that carry it. Strategy and posture live in
[`UPSTREAM.md`](./UPSTREAM.md); this file is the queue.

**Keep it current.** A brick lands here in the same commit that introduces it — see
[`CLAUDE.md`](./CLAUDE.md) → *The board*. A ledger updated afterwards is a ledger nobody trusts.

> ⚠️ **This repo is a standalone fork, not a GitHub fork object**, so a PR cannot be opened from it
> (GitHub requires the head repo to be a fork of the base). To submit: fork `AltanS/collie` on
> GitHub, add it as a third remote, cherry-pick onto a branch there, open the PR. That is why the
> **Extraction** column below matters — it says whether a brick is one `git cherry-pick` or a
> re-assembly.

Status: 🔵 ready · 🟡 needs extraction · ⚪ not started · 🟢 submitted · ✅ merged

---

## 1. 🔵 `collie-ctl.sh` — three ways `start` breaks on a standard install

**The first PR to offer.** Pure bug fix, no board dependency, hits every user, and it is one commit.

| | |
|---|---|
| Commit | `1952610` *fix(ctl): three ways `start` broke on a completely standard install* |
| Files | `scripts/collie-ctl.sh`, `scripts/collie-ctl.test.sh` |
| Extraction | **Clean cherry-pick.** Only the filename differs (`collie-board-ctl.sh`), so the pick needs `-X rename-threshold` or a manual path fix. |

What it fixes, all live-reproduced:

1. **`start` dies with "bun not found" while `bun --version` works.** Herdr runs plugin actions in a
   non-interactive shell, which sources no `~/.zshrc` — so the `~/.bun/bin` entry bun's own
   installer writes there isn't in scope. Resolution now also checks `$BUN_INSTALL/bin`,
   `~/.bun/bin`, `/usr/local/bin`, `/opt/homebrew/bin`.
2. **`BUN="$(resolve_bun)"` under `set -e`** — a command substitution returning non-zero in an
   assignment kills the script, so a machine with no bun exited silently before reaching the message
   explaining what to do.
3. **`tailscale status --json | bun` under `pipefail`** — the pipeline inherits *tailscale's* exit
   code, so a tailscale that is installed but not connected took the whole script down instead of
   degrading to "unknown".

Plus: the `serve` failure now reports what tailscale actually said. It used to blame a missing
certificate unconditionally, which sends someone hitting the `--operator` permission to exactly the
wrong fix.

---

## 2. 🟡 Context gauge, and `$ctx` in herdr's own sidebar

The cheapest genuinely-new capability, and it grafts onto a file that already exists.

| | |
|---|---|
| Commits | `6bce9cc` (the gauge, `latestUsage`, `pane.report_metadata`) · `c0bca59` (adapter gating) · `106b723` (walks agent panes, figure held in memory) |
| Files | `bridge/transcript.ts` (`latestUsage`), `bridge/context.ts`, `bridge/herdr-client.ts` (`reportPaneMetadata`), `web/src/components/context-gauge.tsx` |
| Extraction | **Needs splitting.** `6bce9cc` also carries the card diff and board wiring. Take `latestUsage()` + `context.ts` + the client method. `106b723` removed the one card coupling that stood in the way: `ContextTracker` now walks the snapshot's agent panes and holds the figure in memory, so the board arguments are droppable and the gauge works with no card in sight. |

`latestUsage()` sums `input + cache_creation + cache_read` of the newest **non-sidechain** assistant
turn — both filters load-bearing: a subagent's small window makes a full session read as empty, and
taking the largest rather than the newest would pin the gauge at the pre-`/compact` figure forever.

Pushing it back with `pane.report_metadata` renders it as `$ctx` in herdr's Agents sidebar, so the
number is visible in the TUI, not only in the phone app. ~30 lines, zero coupling.

**Needs a context-window size** (`COLLIE_BOARD_CTX_WINDOW`); herdr doesn't know it and the transcript
doesn't state it.

**Cost, measured** (378 logs, 0.3–18 MB): median 10–23 ms per pane per 30 s refresh, worst 110 ms on
an 18 MB log — ~1 % of one core for a twelve-agent herd. Worth stating in the PR: it reads every live
agent's transcript, throttled per pane, on the existing poll rather than a timer of its own.

---

## 3. 🟡 Find a pane's transcript without the integration — **fixes History for most users**

Probably the highest-value brick here, because it repairs an *upstream* feature that is inert by
default.

| | |
|---|---|
| Commits | `6bce9cc` (`resolveByCwd`) · `7007e29` (`resolveForProcess`, `bridge/proc.ts`, `paneProcess`) · `9fd958e` (the consumer change + the resume fix) · `5182d61` (the client gate) |
| Files | `bridge/transcript.ts`, `bridge/proc.ts`, `bridge/herdr-client.ts`, `bridge/server.ts` (`paneHistory`), `bridge/context.ts` (now shares the resolution), `web/src/components/agent-chat.tsx` (the gate) |
| Extraction | **Needs splitting**, but the pieces are self-contained. `resolveWithoutSession()` is the whole rule in one exported function, and both consumers call it. |

Herdr reports `agent_session` **only** once `herdr integration install claude` has planted its hook.
A plain install has none — verified live: not one agent pane in a four-agent herd carried it. So
Collie's own pane History answers `no-session` for anyone who hasn't run that command, and the
History affordance is never even rendered (`agent-chat.tsx` gates on `agentSessionId`).

Two resolutions, in order:

- `resolveForProcess(cwd, startedAt)` — `pane.process_info` gives the pane's foreground PID,
  `/proc/<pid>/stat` its start time, and the log born closest after it is that process's. Measured
  gap: 7 s. Exact even with two agents live in one directory.
- `resolveByCwd(cwd)` — newest log in the mangled project directory. The fallback when neither start
  time nor birth times are available.

Both platforms Collie targets are covered: `/proc/<pid>/stat` on Linux, `ps -o etime=` on macOS
(`lstart` is locale-dependent — it prints "mar. juil. 28 …" on a French machine). Verified against
each other on one process: 1.3 s apart. Windows has neither and falls back.

A wrong `USER_HZ` can only push the computed start into the future, which the guard rejects → the
fallback answers. It cannot produce a wrong-but-plausible file.

**The consumer change is now made** (it was the missing half): `paneHistory()` falls back to the same
resolution when herdr reports no session, so History — and the reading mode of brick 15 — work on a
plain install. Two guards, because resolution is BY DIRECTORY and a wrong transcript is worse than
none: never a shell pane, and never an agent whose adapter doesn't claim a readable transcript format
(upstream has no adapter table; there the check is "is this a Claude pane").

**And a correction to the rule itself, which upstream should take with it.** "The log born closest
after the process started" is wrong for a **resumed** conversation, which in a long-running herd is
most of them. Live case (2026-08-03): a pane's claude started 09:54:48, Claude Code created a log 17 s
later, then resumed a conversation from four days earlier and wrote everything into THAT file. The
startup log died at 31 entries while the real one reached 20 MB — and the "exact" rule served the dead
one: a stale conversation as the pane's history, and **another session's occupancy on the context
gauge** (brick 2 inherits the fix). The rule is now *the log this process has been WRITING to*, with
birth time kept only as the tie-break for a pane that hasn't written yet. What that gives up: two
agents live in one directory, both writing, is a coin flip again — rare when each agent gets its own
worktree, and far less damaging than confidently serving a dead conversation.

---

## 4. 🟡 Two herdr races every agent launcher hits

Not a feature — three findings that are simply true of herdr 0.7.5, packaged as helpers.

| | |
|---|---|
| Commits | `dcf7f37` (`launchAgent`, `agent_pane_busy` retry, readiness poll) · `09fb97a` (`promptAndConfirm` re-send) |
| Files | `bridge/cards.ts` (the four exported helpers) |
| Extraction | **Needs splitting** — both commits also carry board logic. The helpers themselves have no board dependency. |

1. **`agent.start` does not wait.** The CLI help says success means the agent "is ready for input",
   but that is the CLI polling afterwards: the socket method returns in ~2 ms with
   `agent_status: "unknown"` and `launch_pending: true`. Poll `agent.get` for `interactive_ready`.
2. **`agent.start` right after `worktree.create`** fails `agent_pane_busy` while the pane's shell is
   still sourcing its rc. Retry on that code, and only that code.
3. **`agent.prompt` does not reliably deliver.** A multi-line prompt lands as `[Pasted text #N]` and
   sits there; and Claude Code's first-run trust dialog eats the prompt whole while herdr reports
   `interactive_ready: true`. Read the state back and look — the rule Collie already applies to
   replies in `web/src/lib/reply-action.ts`.

Collie doesn't launch agents today, so this is only useful to upstream **if** it ever does. Offer it
as documentation of the socket's real behaviour if not as code — `HERDR_API.md` is the natural home.

---

## 5. 🔵 Wrap the pane mirror by default on a phone

Tiny, one file, and it fixes the primary screen of a phone-first app.

| | |
|---|---|
| Commit | `9fa4248` *fix(web): wrap the mirror by default on a phone* |
| Files | `web/src/hooks/use-display-prefs.ts` |
| Extraction | **Clean cherry-pick.** |

`DEFAULTS.wrap` is `false`, so the mirror pans horizontally out of the box. Measured on a real herd:
panes run a **median of 81 columns and a max of 233**, while a phone shows about 50 at 12px
monospace — so most lines run off the edge, on the one screen Collie exists for.

Not wrap-always: the no-wrap default is *right* on a wide screen, where preserving column alignment
is what makes a TUI's boxes and tables readable at all. So the default follows the viewport
(`wrapDefaultFor`, < 640px = the app's own `max-w-screen-sm`), and the instant the user touches the
existing toggle their choice is stored and wins forever. Nothing else changes.

---

## 6. 🔵 The frontend test suite is broken by Node 24+

The smallest brick here and the most annoying to diagnose, which is exactly why it is worth sending.

| | |
|---|---|
| Commit | `e52a993` *feat(board): a split makes real cards…* (the fix is the one file below) |
| Files | `web/src/test/setup.ts` |
| Extraction | **Clean cherry-pick.** |

Node 24+ defines its own `localStorage` global that stays **undefined** unless the process was
started with `--localstorage-file`, and it takes precedence over the one jsdom installs. So
`localStorage.clear()` in a `beforeEach` throws, and every display-preference test fails — here, 17
of them — on the day the machine's Node is upgraded, with nothing in the repository having changed
and nothing in the error naming Node as the cause.

Reproduced on Node v26.5.0, vitest 4.1.9, `environment: "jsdom"`. The fix installs a Map-backed
`Storage` when the global is missing, next to the existing `matchMedia` / `scrollIntoView` gap-fills.
Inert on a Node that behaves.

---

## 7. ⚪ Diff view on the focused pane's `cwd`

| | |
|---|---|
| Commit | `6bce9cc` |
| Files | `bridge/git.ts`, `web/src/components/card-diff.tsx` |
| Extraction | **Needs splitting and rewriting.** `git.ts` is scoped by a card's branch; upstream would scope it by the focused pane's `cwd` + its current branch. The parsers (`parseNumstat`, `parseUntracked`, `isSafeDiffPath`) transfer as-is. |

Reading a diff on a phone is missing for everyone, and needs no card. Worth noting the two choices:
diff the **working tree** against the merge base (agents routinely leave nothing committed, so
`base...HEAD` reads empty), and list untracked files separately (`git diff` cannot see them, and a
new file is the most common thing an agent produces).

Check `persiyanov/herdr-reviewr` before proposing — it may already cover this.

---

## 8. ⚪ TOML agent adapters

| | |
|---|---|
| Commit | `c0bca59` |
| Files | `bridge/adapters.ts`, `adapters/agents.toml` |
| Extraction | **Nearly clean.** The module has no board dependency; only its consumers do. |

Four fields — launch kind, context-reset command, whether the transcript is readable, whether a
native session id is reported — merged **per field** from a user file. Only useful to upstream
alongside brick 2 or 4; on its own it configures nothing.

---

## 9. 🔵 The bottom sheet closes on a scroll, and vanishes instead of closing

| | |
|---|---|
| Commit | `5151295` *fix(sheet): a drag in a list no longer closes the drawer, and closing is animated* |
| Files | `web/src/components/ui/sheet.tsx`, `web/src/components/ui/sheet.test.tsx` |
| Extraction | **Clean cherry-pick — from `5151295` only.** The file has since been rewritten over Vaul ([ADR 0003](./.adr/0003-vaul-owns-the-sheet-gesture.md)), so offer that commit, never the current file: upstream has not taken that dependency and this brick must not smuggle it in. |

Every Collie user on a phone hits this: a drag down inside a sheet's list closes the sheet instead
of scrolling it, reopening one flickers, and closing is a hard cut with no animation. Three separate
causes, all in the hand-rolled sheet (upstream doesn't use Vaul either): the pull-to-dismiss arms on
any touch — including one that starts in a field or a scroller; the drag offset survives the close
and replays on the next open; and `onClose` sits in the effect dependency arrays, so every caller's
inline lambda re-attaches the listeners on each parent render. The `onClose` fix belongs in the
component rather than in `useCallback`s at the call sites — that is what stops the next caller from
reintroducing it.

---

## 10. 🔵 Three one-line finishes: `text-wrap`, scroll-snap, haptic confirm

| | |
|---|---|
| Commit | `160007d` *feat(board): the one-line finishes — text-pretty, scroll-snap, haptic arm* |
| Files | `web/src/index.css`, `web/src/components/{space,tab,pane}-strip.tsx`, `web/src/hooks/use-pending-confirm.{ts,test.ts}` |
| Extraction | **Clean cherry-pick.** Every file is upstream's; no card is in sight. |

Three unrelated polish items that happen to be one line each. A global `text-wrap: pretty` / `balance`
rule removes orphan words app-wide (`pre` untouched, so the mirror never rewraps). The three
horizontal chip strips get `snap-x snap-mandatory` + `[&>*]:snap-start` + `scroll-px-3`, so a flick
lands on a chip instead of half-cutting one at the edge. And arming a two-tap confirm calls
`navigator.vibrate?.(10)` from inside `usePendingConfirm`, which every destructive action already
routes through — Android gets the tick, iOS Safari and jsdom no-op on the optional call.

---

## 11. 🔵 `recent_unwrapped` behind the raw-terminal toggle (+ the wire name is snake_case)

| | |
|---|---|
| Commit | `06c1b56` *feat(board): the un-wrapped read source, behind the raw-terminal toggle* |
| Files | `bridge/server.ts`, `bridge/herdr-client.ts`, `web/src/lib/{api,loaders}.ts`, `web/src/hooks/use-display-prefs.ts`, `web/src/components/agent-chat.tsx`, `HERDR_API.md` |
| Extraction | **Clean cherry-pick.** Every file is upstream's; no card is in sight. |

Two things, one of them a plain bug. **The bug:** `ReadSource` declared `"recent-unwrapped"`, which
herdr's socket rejects — the wire name is `recent_unwrapped`, snake_case, even though the CLI
advertises the hyphen in `--source`. The value was unreachable, so the typo had never fired; anyone
who reached for it would have got `invalid_request` on every read. Fixed, and `HERDR_API.md`
corrected (it documented the hyphen too, and was missing `detection`).

**The feature:** `/api/pane/:id?unwrapped=1` reads that source, and `paneLoader` asks for it only
while the raw-terminal pref is on. That pref already bypasses every Claude grammar, so it is the one
mode where dropping the terminal's fixed-width lines can't blind a box-drawing detector; the two
grammar callers (`reply-action`'s verify-before-submit and `harness/guard`) keep reading the wrapped
source through the same `fetchPane`, deliberately. A boolean flag rather than a free-form `source=`,
so a client can't ask for an arbitrary one.

Measured on live panes before shipping (herdr 0.7.x, 236-column host): on **Claude** panes it changes
nothing at all — 129 → 129 lines, zero lines over the terminal width, because Claude's TUI wraps its
own output before the PTY ever sees it. On a **shell** pane it is real: 599 → 501 lines, 96 logical
lines over 236 columns. Upstream gets the honest version of the knob plus the numbers to judge it by.

---

## 12. 🔵 Three accessibility holes: a heading per screen, a reachable dismiss, a barrier per route

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

## 13. 🟡 A type scale, a font decision, and named motion curves

| | |
|---|---|
| Commit | `5e76d50` *feat(board): three type roles, a decided font stack, named motion curves (UI_AUDIT R2-R4)* |
| Files | `web/src/index.css` and ~24 components under `web/src/components/` — everything except the `card-*` / `new-card-sheet` / `routes/board.tsx` sites, which are the fork's own |
| Extraction | **Needs a filter, not a rewrite.** The commit is one mechanical substitution applied everywhere plus one theme block; drop the seven card/board files and the `.adr/` entry and the rest applies to upstream unchanged. No card is in sight in any of it. |

Three findings from the UI audit (`UI_AUDIT.md` §7 R2/R3/R4), all cosmetic, none touching behaviour.
They ship together because they are the same file and the same decision — what the theme is allowed
to decide on a call site's behalf.

**The type scale.** 245 font-size declarations, 76% at 12px or less, and 47 of them arbitrary
(`text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[0.95rem]`). The interesting part is *where* the
arbitrary values sat: all of them **below** Tailwind's smallest rung rather than between two rungs.
That is not a missing size, it is a missing decision — each call site independently deciding that
whatever it was showing deserved to be smaller than the scale went. So nothing was added to the
scale; they folded onto `text-xs`, and what remains is three roles (`text-base` content, `text-sm`
supporting, `text-xs` metadata) documented once at the top of `index.css`.

The other half is the hierarchy that produces: content moved up a rung where it is genuinely content
— the body of a message (which every transcript and prose surface renders through), the agent name
in the sidebar — and markdown headings followed, since `h1`/`h2`/`h3` ran 16/15/14px and so sat level
with or *below* the prose they introduced. Metadata stayed where it was. The gap between the two is
the point.

Two sizes turned out to be ratios rather than rungs and became named classes: the agent-icon initials
fallback (sized by a host tile that ranges `size-4`..`size-9`) and inline `code` (sized by the line
it interrupts). A fixed rung is wrong at one of those two by construction.

**The font.** `--font-mono` opened with `"JetBrains Mono"` and it was never loaded — no `@font-face`,
no preload, no `.woff2` in `public/`, nothing in the precache manifest. The terminal mirror, the
centre of the app, rendered in a different face per device while the CSS asserted otherwise. Upstream
may well prefer to ship the font for real; either answer beats the current one, which is a decision
that reads as made and has no effect. This fork removed the name and declared the platform stack —
reasoning and reversal conditions in `.adr/0004`, which is fork-local and should not travel with the
PR. `--font-sans` was never declared at all and now is.

**Motion.** Not one `ease-*` class in the entire component tree — every animation ran on the stock
curve. Two named curves (`ease-enter` decelerating, `ease-exit` accelerating) and two durations
(150ms/250ms). The lever worth stealing regardless of the naming: the 44 bare `transition-colors`
are reached by retuning `--default-transition-duration` / `--default-transition-timing-function`,
which is one line rather than 44 edits that drift apart again.

**Watch on rebase:** a comment inside a Tailwind `@theme` block cannot contain a straight apostrophe
— Tailwind tokenises it as an unterminated string and the build fails with a message pointing at the
wrong line. The comments in that block use `’`.

---

## 14. 🟡 A desktop mode: sheets from the right, lists that use the width, a reactive `useMediaQuery`

| | |
|---|---|
| Commits | `f42cc9c` *feat(board): a desktop mode — four lanes, sheets from the right, tiles that read their own box* · `a3f3092` *feat(board): a Kanban that reads left to right…* (the width half only) |
| Files | `web/src/hooks/use-media-query.ts`, `web/src/components/ui/sheet.tsx` (+ its test), `web/src/components/{agent-list,space-view,space-overview,command-palette}.tsx`, `web/src/routes/{home,space,detail}.tsx` — everything *except* `routes/board.tsx`, `routes/card.tsx`, `lib/board*.ts`, `card-tile.tsx` and `card-group.tsx`, which are the fork's own |
| Extraction | **Needs a filter, not a rewrite.** The board half and the app half don't overlap in a single hunk; drop the card/board files and what's left applies unchanged. |

Upstream is `max-w-screen-sm` on every route, which is right on the device it was built for and
leaves a desktop browser showing a 640px column in the middle of nothing. Four bricks here are
Collie's, not the board's:

**`useMediaQuery`.** Ten lines: `matchMedia` through `useSyncExternalStore`, at Tailwind's own `lg`
in Tailwind's own unit so the CSS and the JS can't disagree about "wide". Upstream already had a
width test — `wrapDefaultFor(window.innerWidth)` in `use-display-prefs` — but it reads once at mount
and never hears a resize, which is right for a default the user then overrides and wrong for layout.

**The sheet gets a side.** `BottomSheet` becomes bottom-on-phone / right-on-desktop: the same
`SheetShell`, one `direction` apart, which is what Vaul's API is for. Every existing caller (keys pad,
switcher, sessions, diff, palette) inherits it with no change of its own. This is the one piece that
can't be CSS — `direction` is a prop Vaul picks its drag axis and its transform from — and the reason
the hook above exists at all. Two things fell out of doing it: the padding rule moved from "is this
the bottom sheet" to "is this the left nav rail" (a right-hand sheet holds the same padded content a
bottom one does), and `CommandPalette` dropped a `max-h-[85dvh]` override that clipped a panel whose
height comes from `inset-y-0`.

**Lists that use the width.** `AgentList`, `SpaceView` and `SpaceOverview` swap `flex flex-col` for
`grid` — identical below `lg`, then `auto-fill minmax(24rem, 1fr)` above it. Not a breakpoint
ladder, because the question is not how wide the viewport is but how many readable cards fit in it,
and CSS answers that better than three guessed values; `auto-fill` rather than `auto-fit` so a lone
card stays 24rem instead of stretching across a 27" display. `AgentCard` is self-contained, so this
is a container change and nothing else. Home and the space route drop their max-width entirely.

**Not one "desktop width".** Worth stealing as a rule, not just as a diff: the screens that are
SURFACES (a dashboard, a board) lose their ceiling, the screens that are DOCUMENTS keep one — a
2000px line of prose is unreadable however big the display is — and a settings form stays narrow.
Upstream has the same split (dashboard/space vs. the pane mirror's text), so the same rule applies
even though its screens are not ours.

**A note where the pane screen is.** Upstream's centre of gravity is the mirror, and an honest
desktop version of it is a two-pane layout (list left, mirror right) — a rework of `AgentChat`, not a
`lg:` on a container. `routes/detail.tsx` says so in place rather than leaving the next reader to
wonder why every screen but that one widened. Worth knowing: the part that mattered was already
right — `wrapDefaultFor` turns wrapping off above 640px, so a wide window keeps a TUI's columns
aligned on its own.

Not in this brick, and fork-only: the four-lane board, `BOARD_LANES`, the card page's two halves, and
`CardTile`'s container queries. Those are all about cards.

---

## 15. 🔵 A reading mode for the pane screen (and the `after` cursor it needs)

The mirror is double-wrapped and always was: herdr hands us the pane already cut to the terminal's
columns (~81), and the phone then wraps that again at ~50 — so every paragraph of agent prose breaks
twice, the second time mid-sentence. **No wrap setting can fix it**, because the first cut is in the
bytes before Collie sees them. The agent's own transcript was never cut, and Collie already reads it.

| | |
|---|---|
| Commits | `c9a2a32` *feat(transcript): an `after` cursor…* · `73f43f5` *feat(pane): a reading mode…* |
| Files | `bridge/transcript.ts` (`pageEntries`), `bridge/server.ts` (`historyParams`), `web/src/lib/{api,markdown}.ts`, `web/src/components/{reading-view,markdown-text,agent-chat}.tsx`, `web/src/hooks/use-display-prefs.ts` (+ their tests) |
| Extraction | **Clean cherry-pick.** Every file is upstream's or a new one; no card is in sight, and the two commits are already split along the seam (the cursor, then the view that uses it). |

**The `after` cursor** is the piece worth taking even alone. `pageEntries` only ever walked backwards,
which is *why* upstream's history route opts out of the poll loop: following a conversation meant
re-downloading the archive per tick. `after` is the symmetric direction — the turns written since one
the caller holds — with the same cap, the same opaque uuid cursor, and the same "an unknown cursor
degrades to the newest page, never to an empty one". ~15 lines and it makes a live transcript view
affordable at all.

**The mode.** One toggle in the pane header: `[terminal] [reading]`, persisted per device with the
other display prefs. Terminal is untouched — native dialog buttons, key grammars, statusline, the
stranded-draft preview. Reading renders the last 40 turns through the existing transcript view. Not a
second screen: the composer, statusline and gauge sit below both, so replying never means leaving the
thing you were reading.

**The one hazard, handled.** A TUI dialog exists *only* in the TUI, so a reader could otherwise sit
watching an agent that is actually blocked behind a question. Reading mode banners it (`dialogPresent`
is already derived every render for the composer's send guard) and the banner is the button back to
terminal. This is the part to keep if anything else is cut.

**No new poll loop.** The tick is the pane poll's own heartbeat (the router revalidator settling back
to `idle`); a tick that finds nothing costs an empty array. The fetch deliberately re-asks from the
*second*-newest turn, because a tool result lands by mutating the turn that made the call — so the
newest turn we hold can still change after we've seen it.

**Do not use `revision` as the heartbeat** — the trap this shipped with, and upstream would hit it the
same way. `pane.read`'s `revision` is a STUB on herdr 0.7.x: 0 for every pane, always, including
actively-changing ones (`HERDR_API.md` says so, and it is still true on 0.7.5). A revision-driven view
fetches once at mount and then silently stops, which reads as an agent going quiet.

**A draft on the terminal's input line is shown at the tail of the thread**, dashed and named "Draft
in terminal · not sent" — it is in no log, so without it the thread reads as though you never wrote
the message you typed while the agent was busy. It comes from `extractInputDraft`, the value the
composer already surfaces, so the two never disagree. A *queued* message is a different state and
deliberately NOT shown as a draft: Claude Code clears the line and paints "Press up to edit queued
messages", so its text is nowhere in the mirror.

**Markdown tables**, in the same brick because it's the same complaint. `lib/markdown.ts` gained a
`table` block (headers plus rows normalised to the header's column count, escaped pipes respected);
the renderer picks the shape from the column count — a scrollable `<table>` up to three columns, one
labelled card per row beyond it, because four columns on a 360px screen is a horizontal pan. Cells
stay `MdSpan[]` rendered as React elements, so **the XSS boundary does not move** and no
markdown→HTML dependency is added.

---

## 16. 🔵 Which pane am I in? (and a breadcrumb segment that switches within the space)

Two panes of one space+tab — two Claude sessions in one repo, the ordinary case — render an
**identical** pane header on desktop and an identical card on the space screen: same title, same cwd,
same ctx%. Switching between them looks like it did nothing. Live-reported as "clicking either pane
opens the same one"; it never did, the URL and the mirror were right the whole time. Nothing on
screen said so.

| | |
|---|---|
| Commit | `6d75e8a` *feat(pane): say which pane you're in, and switch within the space from the breadcrumb* |
| Files | `web/src/components/pane-menu.tsx` (new, + test), `web/src/components/agent-chat.tsx`, `web/src/components/agent-card.tsx` |
| Extraction | **Clean cherry-pick.** One new file and two upstream ones; no card in sight. |

**The desktop toolbar was missing the segment mobile already had.** The mobile context row ends in
`space › tab › pN`; the desktop breadcrumb stopped at `tab`. Adding it is three lines — but it must
sit *outside* the truncating span beside it, which is `overflow:hidden` and would clip the menu.

**The chip lists THIS SPACE's panes, not the herd.** Upstream's swipe-up sheet (the handle above the
composer) lists every pane in every space, which reads as a detour when all you wanted was the pane
next door. Same rule as the segments beside it: a breadcrumb segment switches *within* its level. The
sheet is untouched and still one swipe away.

**No popover dependency.** The repo has no such primitive and this needs none: an absolutely
positioned list plus a transparent full-screen layer for click-outside. A space with one pane renders
a plain chip rather than a dead affordance.

**The card carries its pane number too** — the space screen is where the tap happens, so the
ambiguity has to be resolved there as well, not only after you land.

---

## 17. 🔵 Slash commands completed as you type, not only from the sheet

The command catalog upstream already ships (`agent-commands.ts`) is only reachable by leaving the
keyboard: tap the Agent button, open a sheet, search, tap back. That is the right surface for
*browsing* commands and the wrong one for the case where you already know the command and have
started typing it. This adds the second half — prefix matches offered inline as you type `/comp` —
and changes nothing about the first.

| | |
|---|---|
| Commit | `0473d39` *feat(web): complete slash commands as you type them in the composer* |
| Files | `web/src/components/command-suggestions.tsx` (new, + test), `web/src/components/composer.tsx` (one import, a 10-line mount, one comment on `insertCommand`), `web/src/components/composer.test.tsx` |
| Extraction | **Clean cherry-pick.** One new file plus a small hook in an upstream one; no card in sight, no board state, no new dependency. |

**One catalog, two surfaces.** Both halves call `commandsFor(agent)`, so a command added to the
catalog shows up in both without a second edit — the failure mode this exists to prevent.

**The trigger is the whole design.** Suggestions fire only while the draft is a lone `/token`: a
slash command is one only at the start of the line, and the first space means the user is writing
arguments rather than still choosing. The strip therefore retires itself and needs no dismiss
affordance. The regex is also what keeps an empty draft quiet — `"".startsWith("")` matches every
command, so a prefix filter alone would light up on a just-cleared input.

**Picking completes, it never sends.** It fills the input (`/compact ` with the trailing space when
the command takes an argument) and returns the keyboard; sending stays the deliberate tap it is
everywhere else. It deliberately does not route through the composer's `insertCommand()`, which
*appends* to an existing draft and would yield `/comp /compact ` — replacing the partial token is the
only correct move, and a comment there now says so.

**A labelled group of buttons, not a listbox.** A listbox promises arrow-key navigation and an active
descendant this doesn't have; native buttons carry Tab and their own accessible names for free.

---

## 18. 🔵 A bell: what pinged, after the notification is gone

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

## 19. 🔵 The foreground notification is a toast, and it says which pane

Brick 18 gave the *missed* ping a home. This one is about the ping that arrives while you are
looking at the app: the service worker suppresses the system banner whenever a Collie tab is visible
(`decidePush` → `suppress`, on the grounds that "the in-app status already surfaces it"), and what
surfaced it was a line in the shared status bar. That bar is latest-wins and shared with every
"Sent ✓" — so a ping landing a second after a send was overwritten before it could be read — and the
line said `claude · webapp`, which is the same sentence for every claude in the herd.

| | |
|---|---|
| Commit | `57d538d` *feat(notify): a ping that lands while you're in the app is a toast you can tap* |
| Files | `web/src/components/agent-toasts.tsx` (new, + test), `web/src/hooks/use-transitions.ts` (returns toasts instead of calling `setStatus`), `web/src/routes/root.tsx` (one mount) |
| Extraction | **Clean cherry-pick**, minus one expression: the detail line prefers the pane's `cardTitle` and falls back to its cwd. Upstream has no cards — drop the `??` and the line is upstream-shaped. |

**Names the pane, not the agent.** `paneDisplayName` — your own pane label, else Claude's `/rename`
session name, else the agent name. Three claudes stop producing three identical notices, and the
name in the toast is the name on the tile you're about to tap.

**Says where.** The herd session (only when it isn't the primary one — that is the one on screen),
the workspace, and the working directory. All read off the snapshot's `AgentView`, so a richer toast
costs no extra fetch.

**Its own channel, not the status line.** Lifecycle pings and action confirmations have different
lifetimes and different worth; one latest-wins slot cannot hold both. The status line keeps every
`setStatus` caller it had.

**Under the header, floating.** The header is how you leave a screen, so a notice that covered the
back chevron and the bell would be the one overlay you can't get past; bottom was already ruled out
upstream (it covers the terminal tail and the composer, which is why the old toasts left it). The
stack is `pointer-events-none` and nothing in the layout moves — the screen stays usable, which is
the property that makes a toast acceptable here at all.

---

## 20. 🔵 A refusal the bridge wrote is shown as the bridge wrote it

The bridge answers every refusal it decides itself with `{"ok":false,"error":"…","kind":"…"}`, where
`error` is a sentence written for a person ("3 agents already running — finish or hand one off
first"). `api.ts` then threw `"<path> → <status> <body>"`, so a phone showed a url, a status code,
and — off the right edge, past the JSON braces — the only half that says what to do. Reported exactly
that way: *"I get an error message /api/etc, something like that."*

| | |
|---|---|
| Commit | `5a7514c` *fix(web): a refusal shows the bridge's sentence, not the url and the status code* |
| Files | `web/src/lib/api.ts` (`errorDetail` → `apiError`), `web/src/lib/api.test.ts` |
| Extraction | **Clean cherry-pick.** No card in sight — every `{ok:false,error}` responder upstream (`/reply`, `/keys`, `/upload`, the pane routes) gains the same thing. |

One function, at the single place the message is built, so no caller has to remember to unwrap it —
the fork had a `boardErrorMessage()` helper doing exactly that unwrapping, and the bug was the four
call sites that used it next to the ones that didn't. A body that isn't JSON, or JSON without a
string `error`, keeps the old `<path> → <status> <body>` form: a proxy's html or a bare 502 has
nothing better to offer, and that prefix is what makes it diagnosable.

---

## 21. 🟡 The pictures an agent makes are unlookable-at from a phone

An agent that generates images — a render, a chart, a mock — writes them into its scratchpad and then
*describes them in prose*, which is the one output a phone client turns back into nothing. The
transcript shows `Read /…/scratchpad/render.png`: the path of a file the operator cannot open. This
adds the two views that make them visible, over one read-only route.

| | |
|---|---|
| Commit | _(this change)_ |
| Files | `bridge/gallery.ts` + `bridge/gallery.test.ts` (new), `bridge/server.ts` (one import + one dispatch block), `bridge/transcript.ts` (`toolImagePath()` + the tool part's `image`), `web/src/{components/image-lightbox,routes/gallery}.tsx` + `web/src/lib/lightbox.ts` (new), `web/src/components/{transcript-view,agent-chat}.tsx`, `web/src/routes/{history,settings}.tsx`, `web/src/lib/{api,loaders,types,nav}.ts`, `web/src/router.tsx`, `web/src/test/setup.ts` |
| Extraction | **Needs extraction.** The new files lift cleanly, but the wiring is spread over ten upstream files and the gallery row lands in a `settings.tsx` the fork has already edited. No card in sight, though — none of this knows the board exists. |

Two views over the same files. **Inline**: a tool call whose `file_path` is a servable image renders
the picture instead of the tool line. **A gallery**: every scratchpad image, grouped by session,
from Settings. Both open one full-screen viewer that swipes through the set — a session's eight
variants are eight swipes, not eight taps in and out. The pane's ⋯ sheet reaches the same set
without going through History — that screen holds no transcript (the mirror is a terminal snapshot),
so the row fetches one on demand and says so when the session made no pictures.

The viewer is `<dialog showModal()>` plus CSS scroll snapping, so the modal layer and the whole
gesture (momentum, rubber-banding, interruption) are the platform's, not ours — the same reasoning
that put Vaul under the sheets. It unmounts while the idle cover is up, because the top layer paints
above the cover no matter what z-index the cover carries.

**The security shape is the part worth reviewing.** The route hands file bytes to the tailnet, so it
has exactly one root — `/tmp/claude-<uid>`, fixed, with no client-supplied component — and serves a
path only if its `realpath` still lands under the root's `realpath`. Resolving first is the point: an
image-named symlink planted in a scratchpad is the obvious way to turn this into "read any file the
bridge user can read", and comparing the paths as written waves it straight through. The listing walk
doesn't follow links at all, and SVG is excluded (an image to `<img>`, a script host to a top-level
navigation on an origin that also serves the app). `gallery.test.ts` drives all of that against a
real directory tree, symlink included — a fake fs would only prove the code agrees with itself.

---

## 22. 🔵 `idle` and `done`, with a since

A settled pane says *what* it is and never *since when*. On the triage screen that is the whole
question: a session that finished thirty seconds ago and one that has been sitting there since
lunch are the same grey word, so the list gives no reason to look at one before the other.

| | |
|---|---|
| Commit | _(this change)_ |
| Files | `bridge/state-engine.ts` (a `statusSince` map + three lines in the poll), `bridge/types.ts` · `web/src/lib/types.ts` (`AgentView.statusSince`), `web/src/components/agent-card.tsx` (+ test), `bridge/state-engine.test.ts` |
| Extraction | **Clean cherry-pick.** No card in sight — the poller, the pane type and the pane row are all upstream's. |

**The poller already knows.** It diffs each pane's status against the previous tick to fire
transitions; stamping `Date.now()` on the same edge costs a `Map` and no extra call. The age then
rides the snapshot every client already polls, so it needs no timer and no second source.

**A pane first seen already `done` carries no stamp.** The bridge did not witness that switch, and
the honest rendering of an unknown instant is nothing at all — a fresh `just now` on an agent that
finished three hours ago is precisely the wrong reading, and the one the operator would act on. It
appears at the pane's next real transition. Same rule the transition listeners already follow (a
first sighting never notifies), and the stamp is dropped with the pane so a reused id starts clean.

**Only `idle` and `done`.** `working` has a live spinner, `blocked` is the thing you are already
being sent to; neither is waiting to be ranked by age. Rendered through the existing `timeAgo()`,
next to the state rather than in a column of its own — a footnote on the word, at the same weight
as the rest of the metadata line.

---

## 23. 🟡 How much Claude Code quota is used, on the dashboard

A herd of Claude sessions burns one shared subscription, and the phone screen that tells you which
agent to look at cannot tell you whether starting another one is affordable. `/usage` knows, and it
is one terminal away — which is the one place a phone is not.

| | |
|---|---|
| Commits | `9cb5d0b` (the gauge) · `0d6816f` (resolve the CLI, PATH is not enough) · `dbf1ba9` (count up, not down) · `e56e817` (one line, then the detail) |
| Files | `bridge/usage.ts` (+ test), `web/src/components/usage-gauge.tsx` (+ test), one route, one line on the dashboard |
| Extraction | **Clean cherry-pick.** No card in sight: a subprocess, a regex and a gauge. Only the route's home moves — the fork hangs it off `/api/board/usage` because that prefix is already dispatched; upstream would give it `/api/usage` in `server.ts`. |

**`claude -p "/usage"` prints the panel as plain text in ~1.5 s and spends no model turn** — the
panel is rendered locally. So this is a subprocess and a regex, not an agent request against the
quota it is measuring. The alternatives were checked first and all came up empty:
`~/.claude/stats-cache.json` holds cumulative tokens and no limits (and went five weeks stale on the
machine this was written on); the session transcripts record no limit state; the OAuth endpoint
would mean reading the user's credentials against an undocumented API. See ADR 0009.

**It disappears rather than lie.** No `claude` to be found, a panel that stops looking like this, a
timeout: the endpoint answers `null` and the gauge renders nothing — the context gauge's posture,
for the same reason. The parse is one exported regex with a captured panel in its test.

**Show what's USED, not what's left.** It first rendered the remainder. Correct, and wrong in place:
the context gauge inches away fills with what's consumed, and `/usage` itself says "% used" — so a
right number gets read as a wrong one. Whichever direction upstream picks, both bars must pick it.

**Do not spawn it by name — this cost a release.** A `systemd --user` unit starts with systemd's own
PATH and reads no login shell profile, so `~/.local/bin` isn't on it and `Bun.spawn(["claude", …])`
fails on a machine where the CLI works fine in a terminal. Every other binary the bridge shells out
to (`git`, `gh`, `ps`) lives in `/usr/bin` and so hid the problem. `claudeCandidates()` checks PATH
first, then the install locations — the same shape `resolve_bun()` already uses in the ctl script.
Upstream will meet this the moment it ships any home-installed CLI.

**Cached fifteen minutes, fetched on mount, refreshable by button.** No timer, no poll loop: a
five-hour window does not move fast enough to earn one, and the loader that revalidates every 1.5 s
is exactly the wrong place to hang it.

---

## 24. 🔵 A notification whose subject is the work, not the worker

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

## 25. 🔵 One composition for all three notification surfaces

Brick 24 fixed the push. Upstream renders the same facts **three times, from three different codes**:
the push (`notifications.ts`), the in-app toast (`use-transitions.ts`) and — here — the bell. Each
composes its own sentence at its own level of richness, so improving one improves nothing else, and
the push, the only surface that counts with the phone in a pocket, was the poorest of the three.
Concretely: after brick 24 a lock screen read `Done · webapp` while the toast for the same event
still read `claude is done · webapp`.

| | |
|---|---|
| Commit | `e79fe29` *feat(notify): the toast and the bell speak the push's sentence* |
| Files | `web/src/lib/notify-content.ts` (new — a byte copy of `bridge/notify-content.ts`), `web/src/hooks/use-transitions.ts` (one call replaces the toast's own sentence), `web/src/lib/types.ts` (`notifyVerb`/`notifyWhere`/`notifyWhat` deleted), `bridge/notifications.ts` (`summarize`'s digest body), `bridge/notify-content.ts` (an optional `session`, and `basename` inlined so the file has no imports) |
| Extraction | **Clean cherry-pick**, and it needs brick 24 first. Nothing in it knows the board exists: with no card the subject falls through to the repo, which is upstream's only case. |

**The copy is checked, not trusted.** The bridge and the web app build from separate source trees on
purpose, which rules out an import across the boundary — the trade upstream already makes for
`paneDisplayName`. What is new is that a test diffs the two files and fails the build the moment they
drift, so "one composition" survives the next edit instead of being a comment that used to be true.

**The digest stops naming panes.** `claude, claude, claude` used the one word herdr reports for every
pane. It lists the subjects now, deduplicated — the count is already in the title, so a repo with two
alerts says its name once.

**What the in-app surfaces add is one optional field.** The herd session, when it isn't the primary
one: a history row and a toast have room to say where to go look, a lock screen does not. One
parameter, not a second composition.

**One deletion falls out of it.** `notifyVerb` ("needs you" / "is done") and its two siblings handed
out the words for a sentence each caller then assembled. With the sentence itself shared, all three
go.

---

## 26. 🔵 The multi-agent digest counts what is waiting, not how many agents

Upstream's digest headline counts the one field that is the same word on every pane: `3 agents done`
tells you a number of workers and nothing about what they left behind. Brick 24 already made the
*body* say the subjects; the title kept counting agents. It now counts **states**: `1 question,
2 done` — questions first, because a blocked agent is stalled on an answer only you can give and a
finished one is not. Fixed order, not sorted by size, so the headline doesn't reshuffle itself on a
lock screen every time one alert resolves.

| | |
|---|---|
| Commit | `b9603b1` *feat(notify): the digest counts states, not agents* |
| Files | `bridge/notify-content.ts` + its byte copy `web/src/lib/notify-content.ts` (the marker split out of `notifyContent` as `notifyMarker`), `bridge/notifications.ts` (`summarize`'s digest branch, ~12 lines) |
| Extraction | **Clean cherry-pick**, and it needs bricks 24 and 25 first. The board only shows through one marker (`Review`, for a card the board moved there), which falls through to `Done` when there is no card — upstream's only case. |

**The count reads the same rule as a single alert's title.** `notifyMarker` is the marker function
`notifyContent` already used inline; the digest calls it and groups by its result, so a digest and
the notifications it collapsed can never disagree about which state one of them was in. The *words*
differ ("1 Needs you" is not a sentence), the rule does not.

**A state with nothing in it is not mentioned.** A uniform herd reads `3 done`, exactly as short as
what it replaces, and strictly more informative.

---

## 27. 🔵 Image upload + clipboard paste as a hook, not composer-only code

Upstream can already paste a screenshot into the composer: it uploads the file and appends the
returned host path to the draft, because Herdr's socket carries no image and the agent reads one by
path. That round-trip is written *inside* `Composer`, so it is available to exactly one textarea —
and the second textarea that wants it has to copy forty lines or do without.

`useImageUpload` is the same code, moved. Same request, same append rule, same status sentence; the
composer now consumes it instead of owning it, and any other draft box gets a screenshot attachment
in three lines.

| | |
|---|---|
| Commit | `4ceb4ca` *feat(card): paste a screenshot into a new card, same upload as a session* |
| Files | `web/src/hooks/use-image-upload.ts` (new), `web/src/components/composer.tsx` (~40 lines out, one hook call in) |
| Extraction | **Clean cherry-pick minus the consumer.** The commit also wires the fork's `new-card-sheet.tsx`; drop that hunk and its test file and the rest applies as-is. |

**`paneId` is documented as the upload's OWNER, not a route.** The bridge only ever uses it for the
saved file's name prefix and the audit line, so a caller with no pane can pass a label and still get
an honestly-named file — that is what makes the hook reusable at all, and it is a property upstream
already has and does not state anywhere.

**The composer's own paste tests are untouched** and still pass against the hook, which is the
evidence the move was verbatim.

---

## 28. 🔵 A notification coordinator that doesn't assume its alerts are panes

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
| Commit | `d3a49fe` *feat(notify): a board fact reaches the phone, in the herd's slot* |
| Files | `bridge/notifications.ts` (the key, the two verbs, `Alert.paneId`, `retract` replacing a private `resolve` and its duplicate in `onTransition`), `bridge/notify-content.ts` + its byte copy `web/src/lib/notify-content.ts` (`notifyCardId` reads the missing pane), `bridge/notify-subtitle.ts` (one gate per entry point, and the deep-link re-stamped on the silent update), `web/src/hooks/use-transitions.ts` + `web/src/components/notification-bell.tsx` (pass / stop duplicating the rule) |
| Extraction | **Needs a subset taken.** Drop the `stalled` status, its marker and its digest line — they are the fork's word for a card whose work stopped, and upstream has no card. What is left is generic and applies as-is: the opaque key, the optional `paneId`, and the two `notify-subtitle.ts` fixes. |

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

## Never offer as one PR

Cards, the board, SQLite, worktree-per-card, session chaining, the copilot. Collie is deliberately
stateless — an ephemeral, single-operator mirror. Grafting a database onto it is a change of kind,
not an extension, and a refusal would be entirely reasonable.
