# 0029 — The board reads the PR's GitHub checks before it merges

**Status:** Accepted
**Date:** 2026-10-10
**Amends:** [0027](./0027-the-board-merges-the-pr-when-github-will-not.md) (not edited: this is its successor)

## Context

ADR 0027 merges on the lead's word and, with a gate, on a green gate. It never read the PR's own
GitHub checks: PR #44 was merged with its CI in FAILURE, `main` went red and the release was skipped.

## Decision

Before the direct merge `landPr` reads `gh pr view --json statusCheckRollup`:

- **a check failed** — no merge. `run.merge { merged: false, ci: { name, log } }` is journaled and the
  coordinator sends the worker back with the check's name and the end of its log (`gh run view
  --log-failed`), as a red gate does: a `run.decision prompt`, so it counts in `MAX_ROUNDS`;
- **checks running** — no merge, `run.merge { wait: true }` once. The card is not filed; `stepFor`
  answers `land` and the coordinator asks again on a later `engine.onUpdate` tick, at most every
  30 s, from the journal (a restart resumes). No timer, no loop;
- **green, or no check at all** — the merge goes on as in 0027. A repo with no CI behaves as before;
- **unreadable** — a skip, like an unreadable `mergeable`.

GitHub's own `--auto` is still asked first and still waits on checks itself: this only covers the
board's direct merge.

## What this rules out

Merging past a red or running check on the lead's word, and a blocking poll waiting on CI.
