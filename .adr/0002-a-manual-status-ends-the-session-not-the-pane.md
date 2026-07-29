# 0002 — A manual status ends the session, never the pane

- **Status:** Accepted
- **Date:** 2026-07-29
- **Shipped in:** 0.40.1

## Context

The board's premise is that cards move on their own: `reconcile()` runs on every poll tick and
mirrors each live pane's `agent_status` into its card's column (`bridge/cards.ts`). That is the
feature — you watch a herd from a phone without touching anything.

It has a consequence nobody wrote down: **a status set by hand does not survive the next tick.**
`setStatus` records a `reason` in the journal but stores no provenance, so reconciliation cannot tell
a human's decision from a stale column. Tap "Done" on a card whose agent is still sitting in its
pane, and a second later the card is back in `working` — with no error, and nothing on screen to
explain why. The same holds for Backlog, Ready and Archive.

Observed live on 2026-07-29, on the card that carried this repo's UI audit. Its journal shows seven
transitions in one session:

```
working → review   (agent done)
review  → working  (agent idle)     ← ×6
review  → working  (agent working)  ← ×1, legitimate: the operator resumed the conversation
```

Two distinct defects, one visible and one silent:

1. **The bounce.** Herdr reports `done` for the instant an agent finishes a turn, then `idle` for as
   long as it waits at its prompt. `STATUS_COLUMN` mapped `idle → working`, so every finished turn
   put the card into `review` and pulled it straight back out.
2. **The review that may never happen.** `CopilotCoordinator.update()` only reviews a card that *is*
   in `review` on the tick it looks. With the card bouncing, whether the copilot ever reviews a
   finished task is a race against the poll interval. The audit card won that race; nothing said so,
   and a card that loses it looks identical.

## Decision

**A manual move out of the live columns ends the card's session. It never touches the pane.**

- `reconcileOne` treats `review` as a landing: an `idle` pane no longer pulls a card out of it. Real
  `working` still does (the operator resumed), and so does `blocked` (a question is waiting).
- `releaseSession` closes the open session when a card is moved by hand to `backlog`, `ready`, `done`
  or `archived` — outcome `done` for the two that mean finished, `abandoned` for the two that put the
  work back on the shelf. Reconciliation iterates `listOpenSessions()`, so a closed session is
  simply no longer reconciled, and the decision stands.

The pane stays open, keeps its agent, and becomes a free pane in the herd. Closing it is a separate,
explicit gesture.

## What this rules out

**"Done should close the pane."** It is the obvious shortcut and it will be proposed again. Closing a
pane is irreversible and can destroy uncommitted work; the terminal is also where you go *after*
marking a card done, to read the diff, commit and push. Making that the side effect of moving a card
between columns is precisely the defect the UI audit flags on the Delete button — a destructive
action reachable by an ordinary gesture. The board owns the `session` row; the herd owns the pane.

**"Ask herdr when a session is finished."** There is nothing to ask. `agent_status` is
`idle | working | blocked | done | unknown` (`HERDR_API.md`), where `done` means *the agent stopped
talking*, not *the task is complete* — which is why it decays back to `idle` on its own. No message
in the protocol lets an agent declare its task closed. The board already knows this and says so in
`handoff.ts`: the note on disk is the real "finished writing" signal, an idle status is not.

**"Let the copilot mark the card done when it passes review."** The copilot's verdict is worth having
and is kept — but it judges from `git diff --stat` and the agent's handoff note, under a prompt that
forbids it from reading the repository. It cannot verify a criterion like "a test covers that one tap
does not delete". A `done` posted on that basis makes the board agree with itself rather than with
the work. The verdict is a proposal on the card; the tap is the operator's.

## Consequences

- A finished card stays in `review` until someone acts on it, so the copilot's review stops being a
  race and the journal stops filling with noise.
- Manual moves stick. This is a behaviour change: before, they were silently undone.
- Nothing closes a pane that the operator did not ask to close — unchanged, and now on purpose.
- A card released this way can be started again: the worktree is still recorded, so `startCard`
  reopens it with a fresh agent.
