# 14. 🟡 A desktop mode: sheets from the right, lists that use the width, a reactive `useMediaQuery`

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commits | `f42cc9c` *feat(board): a desktop mode — four lanes, sheets from the right, tiles that read their own box* · `a3f3092` *feat(board): a Kanban that reads left to right…* (the width half only) · `cef9a92` *refactor(display-prefs): the wrap default reads the viewport through useMediaQuery* · `19d2dc4` *fix(desktop): four screens that still lay themselves out for a phone* |
| Files | `web/src/hooks/{use-media-query,use-display-prefs}.ts` (+ their tests), `web/src/components/ui/sheet.tsx` (+ its test), `web/src/components/{agent-list,space-view,space-overview,command-palette,space-strip}.tsx`, `web/src/routes/{home,space,detail,settings}.tsx` — everything *except* `routes/board.tsx`, `routes/card.tsx`, `lib/board*.ts`, `card-tile.tsx` and `card-group.tsx`, which are the fork's own |
| Extraction | **Needs a filter, not a rewrite.** The board half and the app half don't overlap in a single hunk; drop the card/board files and what's left applies unchanged. |

Upstream is `max-w-screen-sm` on every route, which is right on the device it was built for and
leaves a desktop browser showing a 640px column in the middle of nothing. Four bricks here are
Collie's, not the board's:

**`useMediaQuery`.** Ten lines: `matchMedia` through `useSyncExternalStore`, at Tailwind's own `lg`
in Tailwind's own unit so the CSS and the JS can't disagree about "wide". Upstream already had a
width test — `wrapDefaultFor(window.innerWidth)` in `use-display-prefs` — but it read once at mount
and never heard a resize. The first pass left it alone as "right for a default the user overrides
anyway"; that was wrong, and the follow-up commit above deletes it. A default is only overridden
once the user *has* overridden it, so `wrap` now stays absent from storage until the toggle is
touched: absent, it follows the same hook live; stored, the stored choice wins for ever. One
viewport reader in the app, at the two thresholds it actually has (`lg` for layout, 640px for the
mirror), and no second one to forget to make reactive.

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

**Four bugs the first pass left, worth taking with it.** Every one is a phone rule that nobody
turned off above `lg`, and all four are a class or a deletion: a settings page that capped the
SCROLLER rather than the rows, so the page's scrollbar sat 700px in from the window's edge; a build
stamp printed both in the space footer and in the sidebar footer; `pb-24` of clearance for a tab bar
that becomes a sidebar; and a chip strip whose scrollbar is hidden because you swipe it, which on a
desktop hides its own trailing +. The rule they share: a mobile-first class that reserves space for,
or hides an affordance behind, a TOUCH gesture needs the `lg:` that takes it back.

**A note where the pane screen is.** Upstream's centre of gravity is the mirror, and an honest
desktop version of it is a two-pane layout (list left, mirror right) — a rework of `AgentChat`, not a
`lg:` on a container. `routes/detail.tsx` says so in place rather than leaving the next reader to
wonder why every screen but that one widened. Worth knowing: the part that mattered was already
right — `wrapDefaultFor` turns wrapping off above 640px, so a wide window keeps a TUI's columns
aligned on its own.

Not in this brick, and fork-only: the four-lane board, `BOARD_LANES`, the card page's two halves, and
`CardTile`'s container queries. Those are all about cards.

---
