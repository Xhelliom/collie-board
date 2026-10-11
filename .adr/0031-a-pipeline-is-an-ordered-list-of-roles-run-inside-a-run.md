# 0031 — A pipeline is an ordered list of roles, chained only inside a run

**Status:** Accepted, storage superseded by [ADR 0032](./0032-a-flow-is-a-named-pipeline-kept-in-the-board.md) (a pipeline is a named flow, not a list on the card) — extends [ADR 0026](./0026-an-agent-template-is-a-role-kept-in-the-board.md) (a template is one role)

## Context

ADR 0026 gave a card ONE role: its template's brief goes in front of the first prompt of ONE agent.
The other shipped roles (`reviewer`, `fix`, `doc`) exist but nothing chains them: the operator wants
a card to go through `implementer → reviewer → fix`, each step its own role. Meanwhile the chaining
engine already exists — `RunCoordinator` and the lead move run members, judge each
`review`, and stop at `MAX_ROUNDS` — and a dependency is a gate, never a trigger.

## Decision

**A pipeline is an ordered list of template keys**, on the phase (default) with a per-card override,
resolved like a single template is today (card, else phase, else none). A single template stays a
pipeline of one.

**Each step is a fresh agent session on the same card, worktree and branch.** The branch is what
passes between steps; step N+1 receives its own brief plus step N's final report. A reviewer that
wrote the code does not read it with fresh eyes, so a step never continues the previous session.

**Chaining happens only inside a run** (ADR 0017), as one more `engine.onUpdate` hook of the
coordinator — no new poll. Outside a run the card stops after step 1 and offers "next step:
<role>" as one tap. The step a card stands at is read from the card and its journal, never kept as
runtime state.

**A step that finds a problem stops and tells the operator.** No automatic `implementer ↔ reviewer`
loop in this decision.

**A send-back about the code goes back to the first role.** A red gate, a red CI check, or the lead's own
correction on a card past its first step is sent to the FIRST role, in a fresh session, with the
message; the card is then on step 0 again, so its next landing is judged and handed on to the later
roles afresh. (Live, a reviewer's findings came back from the lead as code fixes three times in five
cards, and the reviewer was the one made to apply them.) Asking for a missing bilan stays with the
session that owes it.

## What this rules out

**A pipeline that starts without consent** — an agent that launches itself spends the quota unseen.
**A graph of steps** — a list is enough until a real case needs branching.
**A step that files cards on its own** (ADR 0018 still holds). **Continuing one session across roles.**

## Consequences

- The lead and the copilot are unchanged and keep judging the end of each step; making them
  templates remains the next step announced in ADR 0026.
- An automatic send-back loop is a later ADR, with its own round limit.
