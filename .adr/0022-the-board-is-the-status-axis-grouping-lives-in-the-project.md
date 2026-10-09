# 0022 — The board is the status axis; grouping lives in the project

**Status:** Accepted
**Date:** 2026-10-09

## Context

A dictation that named several tasks becomes a *container* card plus its sub-tasks. The board then
had to reconcile two axes — the column says a status, the container says "these belong together" —
and it did it differently per screen: on a phone the group was atomic and landed in the container's
derived column; from `lg` up the sub-tasks scattered into their own columns and the container stayed
as a collapsed summary tile. Groups also opened or closed by column, so the list moved when a
sub-task changed state.

The operator named four problems: the board is not the same thing on a phone and on a desk; a group
shows no real progress; groups fold and unfold on their own; and a container cannot be turned into a
lot. All four come from one cause — grouping the work was asked of the screen that sorts by status.

ADR 0021 now gives the work its own structure (roadmap → phase → lot → card) and the project view
to read it.

## Decision

**The board is the status axis, with one rule on every screen: one tile per card, in the column its
status names.**

- A container holds a dictation and no work, so it takes **no tile**. A card is a container when some
  other card names it as its parent, read off the full list so a filter that hides every child never
  turns it into a startable-looking tile.
- Each sub-task keeps its caption naming the dictation it came from, on every screen; the card page
  links to the container, which stays reachable and keeps the original text.
- **A phase is shown, not folded.** A card in a phase carries a pill with the phase's name and its
  progress (`Phase 2 · 3/7`, colour derived from the name like a tag, ADR 0005). `?phase=<id>`
  narrows the board to one phase, composed with repo and tag in the Filter sheet. The pill is
  display only: the tile is a `<button>`.
- **Choosing a lot is a board gesture.** In selection mode, with a phase filtered, "All in phase"
  picks every startable card of it, and the run sheet can *plan* a lot (a name and a phase) instead
  of launching one. Launching stays the operator's tap, in the project view (ADR 0021).
- Progress, order and objectives belong to the project view.

## What this rules out

**A group on the board — atomic, collapsed or summarised.** Whatever its default, it either hides
cards from the status sort or draws a second axis the column cannot honour.

**A different layout per width.** One rule; only the drag stays desktop.

**A collapse state tied to the column.** Nothing on the board folds, so nothing moves by itself.

**A clickable pill on the tile.** A button inside a button is invalid HTML and fires both clicks;
the filter lives in the sheet.

## Consequences

- `CardGroup`, `boardEntries` and `groupOpenByDefault` are gone, with their tests.
- A repo with no phase reads as before, minus the groups: sub-tasks are ordinary tiles.
- The board route loads the project layer (`projectLoader`); outside a repo scope there are no
  phases, so no pill and no phase filter.
- A container's derived status is no longer visible on the board. It is on the container's own page,
  and in the project view's progress.
