# 0025 — Progress is read per milestone, and validating one is the operator's gesture

**Status:** Accepted
**Date:** 2026-10-10

## Context

The project view's headline is derived: finished steps over all steps. On an old project that figure
drifts toward 100 % and says nothing — the project is not done, it is only that everything *planned so
far* was. The operator still wants a number ("to see how we are moving") but one that means something,
and a way to say "this stretch is validated; what is left goes into the next one".

## Decision

**A milestone is a phase the operator has validated** — no new concept, no new table. A phase gains
`closed_at` (and a short `closed_note`); null is the work in progress.

**The headline (ring, counters, percentage) counts only the open scope**: steps that are not in a
validated phase. It starts again from the next milestone. What was delivered is kept and said in one
sentence — "X steps delivered in N validated phases" — and the validated phases sit folded at the end of
the page.

**Validating is a gesture with two parts.** *Close* (`POST /api/phases/:id/close`): the finished cards
stay in the phase, frozen; the open ones move to another open phase of the repo or to none; the linked
roadmap item becomes `done`. Refused while the phase has a lot that is not over (planned or running). It
can be undone (`reopen`). *Seal* (`POST /api/phases/seal`) is the same for an old project with no
phases: it creates a phase already validated and files under it every finished, phase-less card of the
repo — only those.

**The operator does it; an agent proposes.** All three routes refuse (403) a caller carrying
`x-collie-pane`, as the launch of a lot does (ADR 0017, 0021). Deciding that a stretch of work is
done is a judgement, and the orchestrator that planned the work is the last one that should grade it.

## What this rules out

**A single "life of the project" percentage.** It only ever converges on 100 and carries no
information.

**A milestone that closes itself when everything is green.** Green means the planned work is done,
not that the operator accepts it — and a phase with nothing left in it is not a milestone either.

**The orchestrator validating.** It may say "this phase looks done"; the tap is the operator's.

**A separate `milestone` entity.** A validated phase already has a name, a goal, an order, a roadmap
item and cards; a second table would be the same thing under another name.

## Consequences

- Additive migration: two columns on `phase`; existing phases are open, so nothing changes until the
  first validation.
- The `format=steps` export says a validated phase in one line (name, date, number of steps) without
  listing its cards again.
- Reopening a phase puts it back in the headline's scope; the cards that were moved out stay where
  they went.
