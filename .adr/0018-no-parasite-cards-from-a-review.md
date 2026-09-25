# 0018 — A review files no parasite cards

**Status:** Accepted
**Date:** 2026-09-23

## Context

The review's `todos` become backlog cards, so the board refills itself from what the agents left
undone. The `tiny` filter (`isTinyFollowUp`, `bridge/copilot.ts`) already keeps the one-line edits
off the board as tap-to-finish actions. But the filter only answers "is this too small for a card" —
never "should this exist at all" — and a pass over the copilot-filed cards showed four recurring
shapes that should never have become cards, each with real examples from the board:

1. **A research task invented on an empty diff.** `6aa33370` ("Retrouver ou refaire l'affichage du
   conflit de PR") was filed by a review that read an empty diff: with nothing changed, a
   non-tiny suggestion is the model inventing work from the handoff alone.
2. **A check filed by a `complete` verdict.** `36ff4609` ("Vérifier la carte de mise en œuvre
   promise par §3.5") came out of a review that judged the work complete: checking that a card
   exists is one glance at the board, not a card with a worktree.
3. **Branch janitoring cut as a card.** `58a32dac` ("Sortir AGENTS.md et CLAUDE.md du périmètre de
   la carte scroll", untracked strays) and `39918788` ("Retirer scroll-area.tsx, AGENTS.md et
   CLAUDE.md de la branche STEP", a file from another card plus two Next-regenerated files) both
   ask to take files OUT of the branch that is already open. A new card cuts a NEW worktree, while
   the cleanup belongs on the reviewed branch before it merges — structurally wrong, not heavy.
4. **The same work re-filed under a new title.** `6aa33370` covers the exact work later filed as
   `f57d8623` + `1b54e954` (PR-conflict `mergeable` + conflict sentence). The pipeline's
   already-filed dedupe was an exact title match, so any rewording refiled the work. The code said
   what to do about it ("telling the prompt what is already filed; do it the day a near-duplicate
   actually costs someone a triage") — that day is this ADR.

Two more shapes were examined and deliberately NOT treated:

- **Debt-triage cards** (`b24d68e7`, `a415ddf9`: "reprendre/trier la dette consignée dans
  `docs/dette-technique.md`"). The debt file is a parking lot by design; deciding per entry between
  "keep" and "file" is real triage work with real decisions, and a card is its right vehicle.
- **Conditional dead-code removal** (`ddb1cef2`: "Retirer paneDisplayName s'il n'a plus
  d'appelant"). The content is NOT known in advance — grep first, delete only if orphaned — so it
  fails clause 2 of the tiny criterion by construction, and removing code across the repo is not
  branch janitoring. It stays a card.
- **Uncommitted files** (`479f6895`, `ff361918`): the sister card owns this motif (commit action on
  the reviewed card instead of a new card) and is not duplicated here.

## Decision

**A review that has nothing to file, files nothing — and says what it refused, in the journal.**
Three gates, enforced twice: once in the prompt (the model judges intent), once in code (the bridge
holds the shape):

- **Empty diff → no new cards.** `isEmptyStat` (`"(no changes)"` from `formatDiffStat`, or blank):
  non-tiny suggestions are dropped (`empty-diff`); tiny actions still reach the agent that is still
  here, which is the only direction that survives an empty diff.
- **`complete` verdict → no new cards.** A complete verdict closed the work; a non-tiny suggestion
  is a new work item wearing a follow-up's clothes (`complete-no-cards`). A check that changes no
  code is a sentence for `notes`, not a follow-up — the prompt says so by name.
- **Branch janitoring → action, never a card.** `isBranchCleanupTodo` (take-out intent AND branch
  scope — branch, diff, commit, untracked, generated — in `docs`/`chore` only) rides the `TinyTodo`
  row exactly like a tiny follow-up, even when the model did not answer `tiny`. The category floor
  still holds: a `bug` or `feature` that merely sounds like cleanup stays an ordinary card, the
  harmless direction.
- **Already filed → refused folded, shown to the model.** Titles dedupe on `normalizeTitle` (case,
  accents and punctuation carry no meaning); the last 20 filed titles ride in the prompt under
  `ALREADY FILED`, which is the half that catches a genuine rewording. Refusals within one answer
  count too: two identical suggestions file one card, not two.
- **Every refusal is journalled** as `copilot.review_filtered` with title and reason — a silent drop
  is a review the operator cannot audit. Refusals by the operator's own switches (`autoFollowUps`,
  per-category) stay silent: those are settings, not surprises.

## Consequences

- On an empty diff or a complete verdict, the model can still offer tiny actions to the agent that
  is still there — the gates only ever remove *cards*, never the row.
- A `complete` review that spots genuinely new, larger work no longer files it: the finding belongs
  in `notes`, and the operator files the card by hand. Deliberate bias toward fewer cards; the
  journal shows what was refused, so nothing vanishes silently.
- The folded dedupe can over-match (`bus`/`bu`-class collisions are why there is no stemming — only
  folding of case, accents and separators). An over-refused follow-up lands in the journal with
  reason `already-filed`, one grep away from being re-filed by hand.
- **What would justify revisiting:** a journal full of `empty-diff` refusals on cards whose handoff
  describes explicit, larger remainders — that would mean the empty diff was a timing artefact
  (commit landed a second later, cf. `wrapup.ts`) rather than an empty turn, and the gate should
  learn to wait instead of drop.
