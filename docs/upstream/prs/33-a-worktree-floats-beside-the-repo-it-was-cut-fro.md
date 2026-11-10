# 33. 🔵 A worktree floats beside the repo it was cut from, and the Spaces screen shows neither

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `2be764e` *feat(spaces): la page « spaces » prend la forme de herdr, worktree rattaché à son repo* |
| Files | `web/src/lib/spaces.ts`, `web/src/components/{space-pane-tree,space-overview,status-badge}.tsx`, `web/src/routes/spaces.tsx` |
| Extraction | **Clean cherry-pick.** Nothing here reads a card. The nesting keys off herdr's own worktree layout, which upstream Collie sees whenever the operator runs `herdr worktree` by hand; the Spaces screen rewrite carries brick 32's one-line `branch` caveat and nothing more. |

Brick 32 grouped the pane list by space and stopped there. Two things it left standing:

**A worktree is a space to herdr**, so it landed at the top level next to the repo it was cut from,
with nothing tying the two — and in the board's case named after a truncated card title, which reads
as an unrelated project. `groupPanesBySpace()` now hangs it under its repo, keyed off the only thread
the snapshot carries: herdr parks worktrees at `<…>/worktrees/<repo dir>/<branch slug>`, so the
segment before last names the repo. No pane field declares a parent and none is invented — a worktree
whose repo has no space open stays a root, and a directory that merely shares a repo's name is not
mistaken for one. No extra git call, no extra poll.

**The Spaces screen never got the treatment at all** — one card per space, tabs as chips inside it,
no branch, no hierarchy. It now renders the same `<SpacePaneTree>` as the desktop column and the
switcher sheet: three surfaces, one body, and a card grid deleted. Its tab chips go with it; the
space screen behind the drill-in already owns tab selection and creation, and a row names its tab
when its space spans more than one.

The attachment is drawn, not transcribed: the child section steps in one rung, its dot caps its own
rail, and a 1px horizontal hairline reaches back to the parent's — herdr's `└─` without herdr's
typography. Every offset descends from one origin (`railX(depth)`) instead of hard-coded px, which is
what makes depth possible without a second copy of the row.

Ordering follows the subtree (a blocked worktree pulls its repo to the top); the counters do not — a
header speaks for its own panes, and the child's says the child's. Two separable bits ride along:
`groupPanesBySpace()` takes the space list so a screen that lists *spaces* can show one with no pane
in the snapshot (the switcher, which lists what you can switch *to*, doesn't pass it), and `StatusDot`
takes a `style` — an indented rail's geometry is not expressible as a static utility class.

---
