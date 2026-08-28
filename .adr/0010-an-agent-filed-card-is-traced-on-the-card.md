# 0010 — An agent-filed card is traced on the card, not on the session

- **Status:** Accepted
- **Date:** 2026-08-27
- **Shipped in:** 0.130.0

## Context

Three writers put cards on this board. A person dictates one. The copilot's review files follow-ups
while you are elsewhere, and those have carried `origin = "copilot"` — the **auto** badge — since
0.81.0. The third has been invisible: an agent session, mid-turn, decides there is something worth
recording and `POST`s a card through the local HTTP API (the `collie-board` skill). It lands in the
backlog looking exactly like a card someone sat down and wrote, and neither the card nor the session
says otherwise. Six hours later the only honest answer to "why is this here?" is a shrug.

The trace could live in either of two places, and they are not the same thing:

- **On the session.** The session knows what it opened; a "cards filed this turn" list would answer
  *what did this agent do while I was away*. But `session` is the ephemeral half of the one rule the
  board is built on (`card` durable, `session` ephemeral): it is closed by the next handoff and
  cleaned up after the wrapup, while the card it filed sits in the backlog for weeks. And the
  question is not asked in front of the session — it is asked in front of the **card**, on a phone,
  scrolling a column, long after the pane is gone.
- **On the card.** `Card.origin` was built for exactly this: a field rather than a boolean,
  documented as "one value today", precisely so a second writer could be told apart from the first
  rather than flattened into "not a human". `origin_card_id` already renders `from “…”` on the tile
  and at the top of the card screen, already tolerates a dangling source, and — like `origin` — is
  unreachable from any PATCH, so the mark cannot be edited off.

There is a second problem underneath: **the bridge cannot tell who is calling.** The API is
loopback, the write path is a request with no `Origin` header, and a card from the phone and a card
from an agent are byte-identical. Something has to declare itself. Every herdr pane has
`HERDR_PANE_ID` in its environment, and the board already stores that pane id on the open session of
the card being worked on — so a pane id is both the one thing an agent knows about itself for free
and the key to the card it is working in.

## Decision

**The trace lives on the card.** A card filed by an agent gets `origin = "agent"` — a second value
in the existing enum, not a new field, not a tag (ADR 0005) — and `origin_card_id` pointing at the
card whose open session filed it. The tile shows an **agent** badge beside the title, where the
copilot's card shows **auto**; the `from “…”` caption that a follow-up already renders is the way
back to the work the card came out of.

**Provenance is derived, never declared.** The caller sends its pane id in `x-collie-pane`
(`bridge/board-routes.ts` → `PANE_HEADER`) and nothing else: `origin` and `origin_card_id` stay out
of the create allowlist in `parseCardBody`. The caller says *who it is*; the bridge decides what that
means. A browser never sends the header, so a person's card stays a person's card by construction
rather than by care.

**A pane the board doesn't know still gets the mark, with no link.** `openSessionByPane` matches
OPEN sessions only — herdr reuses pane ids across restarts, so a closed session's pane is not
evidence — and no match means `origin = "agent"`, `origin_card_id = null`. Knowing an agent wrote it
is the part the tile needs; the link back is a bonus only a board-started session can give.

**The session's side of the trace is a journal entry, not a column.** Creating the card records
`card.filed` on the source card, carrying the filing session's id and the new card's title. The
card screen already renders the journal, so this costs no storage, no migration and no screen — and
it is the only place that says *which* session filed it, which a link to a card with a handoff chain
cannot.

**The copilot path is untouched.** Its follow-ups are still written with `origin: "copilot"` from
`copilot.ts`, still badge as **auto**, still list themselves on the review record of the card they
came from. The one behaviour that changed is shared: the board's *Source → Auto* strip now means
"filed without anyone asking" and matches both writers, because a strip that answered that for one
of the two would be a gauge that is quietly wrong.

## Consequences

- The filter's query key changed with its meaning: `?origin=copilot` → `?origin=auto`. An old link
  degrades to *no filter*, which is the safe direction — it shows more cards, never fewer.
- **An agent that doesn't send the header is invisible.** The mark is opt-in by construction: the
  bridge has no other way to know, and inventing one (peer pid, cwd sniffing) would be a guess
  dressed up as provenance. The skill documents the header; an agent that skips it files a card that
  reads as a person's, exactly as today.
- **Nothing stops a local caller forging the header.** Deliberate: anything that can reach this API
  can already start an agent and type into a real terminal (ARCHITECTURE.md §6). The header is
  attribution, not authentication.
- An `agent` card has `origin` set and `category` null, which no copilot card ever has. That is
  correct — `CardCategory` is the *review's* classification of its own output, and the switches that
  consult it exist to throttle the review, not a working session — but it does mean "has an origin"
  and "has a category" are no longer the same set.
- **What would justify revisiting:** a screen that must answer "which session opened this" without
  opening the source card's journal. The upgrade is additive — an `origin_session_id` column, seeded
  from the `card.filed` entries already recorded — and nothing above needs un-inventing to get there.
