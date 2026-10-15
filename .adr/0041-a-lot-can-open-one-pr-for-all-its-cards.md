# 0041 — A lot can open ONE PR for all its cards

**Status:** Accepted — amends [ADR 0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md)'s step "PR per card"; applies [ADR 0036](./0036-github-not-answering-yet-is-a-wait-and-only-a-landing-files-the-card.md)'s "filed once landed" to the lot's PR

## Context

A launched lot opens one PR per card and merges each when CI is green. On a repo whose CI is billed
(~12 min per PR) a lot of 3 cards costs 3 CIs. Merging the cards into one card by hand loses the
split, the per-step reviews and the parallelism.

## Decision

**A lot has a setting `integration: "card" | "lot"`, default `card` (nothing changes).** With `lot`:

- **Where it lives: on the lot** (`run.integration`), set at `POST /api/runs` or `PATCH /api/runs/<id>`
  while the lot is planned, like `maxParallel`. Not on the phase (a phase holds many lots, each with
  its own risk) and not on the repo (it would flip every lot, and the cost argument is per lot).
- **The lot branch.** Cut from the first card's base when the first card of the lot starts
  (`board/lot-<slug>-<id6>`, recorded as `run.lot_branch` + `run.lot_base`). Launch is the operator's
  gesture; the branch is made the moment something needs it, not before.
- **Every card starts from the lot branch** — its `baseRef` is the lot branch, so its diff, its
  review and the lead's stat read only its own work, and card 2 sees card 1's.
- **Accepted by the lead → folded locally**: `merge --no-ff` of the card branch into the lot branch
  (`bridge/lot.ts`), done in memory (`merge-tree` + `commit-tree` + `update-ref` guarded by the old
  sha) — the lot branch has no checkout and the main checkout is never touched. No push, no PR.
  Journaled `card.lot_merged`. A fold that races another moves nothing and is asked again next tick.
- **A conflict is the card's**, exactly like `resolve`: its agent merges the lot branch in, lands
  again, the lead re-checks, the fold is retried.
- **The last card to land opens the PR.** "Last" is read, not counted: the card whose fold finds every
  other member filed. It pushes the lot branch, opens ONE PR against the lot's base and runs the
  existing policy on it (`mergeWhenReady`, the repo gate verdict, auto-merge) — the PR is journaled
  on that card, which stays open until the PR lands. The others are filed as soon as they are in the
  lot. Fold / file / PR steps of one lot go one at a time, which is what makes "every other member is
  filed" true.
- **A red PR goes back to that last worker card**, as a round, with the check's log (ADR 0029). Its fix
  is folded again and pushed to the PR. No separate fix card.
- **The repo gate still runs per card, on its checkout**, before the lead sees it.

## `/api/cards/<id>/pr`

A card of a lot with a started lot branch answers with **the lot's PR**, whichever card is asked
(`lotPrCard`: the card seen with the lot's branch and base). Everything that reads "the card's PR"
(`prForCard`, `mergeWhenReady`, `prStatusFor`) goes through the same view.

## Cleanup of the cards' checkouts

Once folded, a card's base is the lot branch and it has nothing ahead of it, so the ordinary cleanup
after the wrapup removes its checkout. `cleanupCard` deleted the branch with `git branch -d`, which asks
"merged into HEAD" — false for a branch folded into a lot. It now uses `-D` when the branch is an
ancestor of its base: reachable from the base is the same guarantee that nothing is lost, and the
lowercase flag was only ever a proxy for it. The lot branch itself stays after its PR merges (cheap,
and the PR's head); deleting it is a separate cleanup.

## What this rules out

- A second PR per lot, or a fix card attached to the lot: the last card is the one that owns the PR.
- Pushing card branches: the lot's CI is the one that runs, on the union.
- A lot that mixes both modes: the setting is the lot's.
