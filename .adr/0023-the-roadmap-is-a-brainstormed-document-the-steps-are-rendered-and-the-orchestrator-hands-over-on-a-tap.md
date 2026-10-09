# 0023 — The roadmap is a brainstormed document, the steps are rendered, the hand-over is a tap

**Status:** Accepted
**Date:** 2026-10-09

## Context

ADR 0021 gave a project a roadmap of *intents* — a name, a goal and a status per phase. The operator's
way of running a project (Overgate) shows that is too thin: what made it work was a real brainstorm at
the start that produced the whole plan — a vision, phases each with an objective, an end-of-phase demo,
the risk it treats and why it comes where it does, a journal of decisions marked ✅ decided / 🟡 leaning /
❓ open — and then tickets written for the *next* phase only, because what a phase teaches changes how
the following ones are cut. That brainstorm is a phase of the project in its own right.

Two further questions came with it: where the "step by step" file comes from, and what happens to an
orchestrator whose conversation is the product (a brainstorm is long, and a conversation compacts or is
lost).

## Decision

**The roadmap is a document, written by the orchestrator with the operator.**
- Each item keeps a `detail` (Markdown, ≤ 20 000 characters): objective, end-of-phase demo, risk, why here.
- The roadmap keeps a **decision journal**: `{id, text, status: decided | leaning | open, itemId?}`, at
  most 300. A decision is written *when it is taken* (`POST /api/roadmap/decision`, an upsert that needs
  no revision, so the orchestrator never races the operator's editor); an open question is a decision
  still `open`, and is updated, not re-filed, when it is settled. A `PUT /api/roadmap` that omits the
  journal leaves it alone.
- The brainstorm is the phase **« Cadrage »**: an `active` roadmap item (and a phase of that name) while
  it lasts, `done` when the operator validates the plan. It is not a card.

**The step-by-step roadmap is rendered, never authored.** `GET /api/roadmap?format=steps` writes the
board's own phases, lots and cards — status, spec, acceptance criteria, what each waits for — in order;
`format=md` writes the detailed document. Phases with no card are left out: the orchestrator cuts only
the next phase into lots and cards, just in time. The caller commits either file into the repo; the
bridge never writes there (ADR 0013).

**The orchestrator has a memory: a short note, one per repo.** `PUT/GET /api/orchestrator/memory`
(≤ 4 000 characters, last writer wins). It writes the note at each milestone — where we are, what was
dropped, the next question — and a new orchestrator is started with that note in its first prompt.
Everything that outlives the conversation is already a row (roadmap, decisions, phases, lots); the note
holds only what is not: the thread of the discussion.

**Handing over is the operator's tap, with an alert.** `GET /api/orchestrator` reports the pane's
context occupancy (the existing gauge) and when the note was last written. At about 50 % the panel says
so and offers two taps: *ask for the note* (`POST /api/orchestrator/renew {step: "ask"}`), then, once
the note has moved, *start fresh* (`step: "restart"`: close the pane, start a new one that reads the
note). A request carrying an agent pane's header is refused: the agent that is renewed cannot renew itself.

## What this rules out

**A roadmap scattered over cards.** A card is a thing to start; the plan three phases away is not.

**A second, free-form step-by-step document.** It would be written twice and disagree with the board.

**An automatic renewal.** The conversation visible on screen would change under the operator's eyes in
the middle of a brainstorm, and the note would be written when the agent is already at its worst.

**Reconstructing decisions at the end.** The journal is the point of the brainstorm; written afterwards
it is a summary, and a summary is what the operator wanted to avoid.

## Consequences

- Additive migration: `roadmap.decisions`, `orchestrator_memory`; items of older roadmaps read with an
  empty `detail`.
- The orchestrator's start prompt now teaches the brainstorm (one theme at a time, restate and confirm),
  the immediate writing of decisions and the just-in-time cutting of phases; the `collie-board` skill
  documents the routes.
- The note can be wrong or stale; it is shown read-only in the panel and the board remains the truth.
