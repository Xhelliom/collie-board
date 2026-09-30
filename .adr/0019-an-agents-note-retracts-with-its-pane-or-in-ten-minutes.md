# 0019 — An agent's note retracts with its pane, or in ten minutes

**Status:** Accepted
**Date:** 2026-09-30

## Context

`POST /api/board/notify` lets an agent send a push in its own words. The typical sender is an
agent **still working** that reports as it goes ("tests pass, starting the migration"): it goes
neither `blocked` nor `done`, and its card does not move. [ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md)
lets a board alert into the herd's slot only with a readable predicate for when it stops being
true. The card's fingerprint is not one here (the card stays put, so the note would stay up for
the whole run), and a pane with no card has no fingerprint at all.

## Decision

**A note holds while its pane reads as it did when it spoke, for ten minutes at most.** A status
change (the pane's own alert takes over), the pane vanishing, or the timeout retracts it. One note
per pane (`note:<paneId>`): a newer one replaces the older in the slot. The bell keeps every note
past the retraction, so a note that timed out off the phone is still readable.

**Same slot, same digest, same snooze, as `Needs you`.** No tag or preference of its own
(ADR 0011: no second channel).

**The alert carries no `paneId`**, although it comes from one: a pane alert's subtitle is
rewritten from the transcript before it fires, and the note *is* the subtitle. It taps to its card
when there is one, home otherwise.

## What this closes

- **"Keep the note up until the agent finishes."** No: it is news, not a state, and a digest that
  says "Needs you" for a progress line from an hour ago is the stale slot ADR 0011 forbids.
- **"A persistent note channel."** No: second channel.
- **"Only card sessions may notify."** Shipped that way in 0.161.0 and reversed here: the predicate
  is the pane's, so a hand-launched agent sends too.
