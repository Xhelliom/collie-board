# 0006 — The board scopes by repo with a chip strip, and remembers the scope

**Status:** Accepted — 2026-08-03

## Context

One board held every card of every repo. That is right for triage — "what needs me, anywhere" — and
wrong for working: three repos of cards is three times the column to read before finding the one
card you meant to open, and the phone shows one column at a time.

So the board needs to narrow to a repo. Three questions had to be answered, and each has a plausible
answer we are closing off:

**Tabs or a filter?** Tabs (`<Tabs>`, a real tablist) are the strongest idiom when the set is
bounded, known and fits the width. The repo set is none of those: it is derived from the cards, it
grows with every repo carded, and on a phone four repo names already overflow. The sessions side of
this app hit the same problem for spaces and answered it with `SpaceStrip` — a horizontally
scrolling row of pills, lead chip escapes to "All". The board's tag filter (0.68.0) is already that
same row.

**What does the board open on?** Either the global view every time, or the last scope chosen. The
global view is the honest default for a triage surface, and it is what the tag filter does — a tag
is a momentary lens, and losing it costs nothing. A repo scope is not that: it is *where you are
working today*, it survives the app being closed, and — the practical part — the card page returns
to a bare `/board` with no query string on it, so a URL-only scope is dropped every single time you
open a card and come back. That is the gesture this board is made of.

**Does the global view name each card's repo?** Adding a line to every tile costs density on the
surface that has least of it.

## Decision

1. **A chip strip, not tabs** — `RepoFilter`, the same row shape as `SpaceStrip` and `TagFilter`:
   `Repos  [All] [collie-board] [herdr] …`, most recently touched first, above the board's scroller.
   Tapping a chip scopes; tapping it again, or "All", goes global. One tap either way, from the
   board, on any screen size. It draws nothing when there is nothing to choose between.
2. **Repo above tag, and they compose.** Repo is the coarse axis (where the work lives), tag the
   fine one (what kind). Scoping to a repo narrows the tag strip to *that repo's* tags, so the two
   rows can never offer a combination that is empty.
3. **The scope is remembered** (`localStorage`, `collie:board-repo`), and seeded into the URL on a
   board opened without one. "All repos" is remembered as a choice too — picking it means the board
   opens global from then on. The URL stays the source of truth, so Back still undoes a scope and a
   scoped board is still a link you can send yourself.
4. **The global view names each card's repo**, on the tile's meta row, and *only* there: under a
   scope the strip has already said it once for the whole board.

## Consequences

- A phone board can now carry two filter rows (~80px) before the first card. Both hide themselves
  when they filter nothing, so the common board — one repo, no tags — is unchanged.
- Cards with no `repoPath` are reachable only from the global view. They cannot be started anyway
  (the bridge refuses), and a third "no repo" chip would be a chip for the cards you can't act on.
- Two repos whose last path segment is the same show two chips reading the same word. They scope to
  different paths, so only the label is ambiguous. Disambiguate by parent directory if it ever bites.
- A remembered scope means "no cards" can greet you on a board you did not knowingly filter. The
  empty state names the scope and offers one button out; the strip stays drawn even when the scoped
  repo is the only one left, so the way out is never off-screen.
- Reordering by drag under a scope orders against visible neighbours only — the same known limit the
  tag filter already carries (`neighbours` in `routes/board.tsx`).
- Revisit if the repo list routinely runs past a dozen: a strip you have to scroll to find a repo in
  is a picker, and a picker is a sheet, not a row.
