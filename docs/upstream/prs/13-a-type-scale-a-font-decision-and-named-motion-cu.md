# 13. 🟡 A type scale, a font decision, and named motion curves

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

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
