# 0040 — A lot with a living orchestrator is pushed by the orchestrator

**Status:** Accepted — applies [ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md), amends nothing

## Context

During a launched lot the phone received every step of every card: the worker done, the lead's
verdict, the copilot's review (up to four per card), the card ready, the run finished. The
orchestrator already hears all of it ([ADR 0028](./0028-the-orchestrator-is-woken-by-the-board-at-the-end-of-a-lot.md))
and makes the bilan — the pushes duplicate it and drown the operator.

## Decision

**An alert about a card of a launched, unfinished lot — and the lot's own `run finished` — stays in the
bell and the log and does not push, as long as that repo's orchestrator is alive.** The push goes to
the orchestrator, through `POST /api/board/notify` (`done` at the end of a lot, `question` for a card
the lead left blocked); its brief says so, once each.

- **Decided when the alert fires**, not when it is armed (`bridge/lot-push.ts`, a `hold` hook of the
  coordinator): an orchestrator that dies mid-lot makes every *following* alert push again, and a
  `blocked` nobody resolves is never silent for ever. Alerts already held stay in the bell.
- **Off without an orchestrator, and by one switch**: `NotifyPrefs.lots`, default on, next to
  `done`/`blocked`. Not a preference per event ([NOTIFY_AUDIT.md](../NOTIFY_AUDIT.md) §6).
- **No second channel.** A held alert is simply not in the herd's slot; the orchestrator's note is
  an ordinary `note` in it. A `note:` alert is never held.
- Held alerts do not trigger the copilot's subtitle rephrase (nothing pushed to rephrase).

## The log says what it decided

Every entry of `/api/notifications/log` carries **`pushed: boolean`**: `true` if the alert left as a
push, `false` if it stayed in the bell — held by this rule, or a bell-only fact (`tell()` in
`board-notify.ts`: copilot review, cleanup refused, …). A consumer of the log
([ADR 0013](./0013-the-bridge-does-not-know-its-consumers.md)) follows the same decision without
recomputing it. The orchestrator's own notes read `pushed: true`. Snooze is not folded in: it mutes
the sink after the decision and is the operator's, not the board's.
