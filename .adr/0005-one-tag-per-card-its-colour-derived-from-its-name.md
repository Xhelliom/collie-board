# 0005 — One tag per card, its colour derived from its name

- **Status:** Accepted
- **Date:** 2026-08-03
- **Shipped in:** 0.67.0

## Context

The board had no way to say what KIND of work a card is. Everything a card carries is either
free text (title, spec) or a pointer at another card (parent, dependsOn, duplicateOf) — nothing
groups cards that have nothing to do with each other but belong to the same effort.

Adding a tag raises two questions that everything built on top of it inherits, and both have an
answer that is easy to reach for and expensive to undo:

- **How many tags per card?** The obvious answer is "a list, obviously — it costs nothing". It does
  cost something: a list needs a picker with add/remove, a wrap rule on a 360px tile, and an answer
  to "which of these five colours is the card's colour" for every place that wants to colour a card
  by its tag.
- **Where does the colour live?** The obvious answer is "store it with the tag, then the operator
  can choose it". That makes the colour a second source of truth for something the name already
  determines: a tag written by the copilot on one card and by hand on another gets two colours, and
  a rename either loses the colour or silently keeps the old one.

The cards already on the board have no tag, and there are enough of them that a model requiring one
would mean a backfill — inventing a value for every existing card, none of which anybody chose.

## Decision

**A card carries at most one tag** — `card.tag TEXT`, nullable, no join table. No tag is a normal
card, not a row awaiting migration: nothing backfills, nothing rejects, and every screen renders a
card without one exactly as it did before tags existed.

**A tag's colour is computed from its name, and stored nowhere.** `tagHue()` (web/src/lib/board.ts)
hashes the name onto one of twelve 30° hue bands; `.tag-chip` (index.css) fixes lightness and chroma
per theme so only the hue varies. The name is therefore the tag's whole identity, which is why it is
normalised — lowercased, whitespace-collapsed, 24 chars — in `BoardDb`, not at the HTTP edge: the
copilot writes tags through `patchCard`, so a check in `parseCardBody` alone would let the one writer
that INVENTS tags invent `Bug` beside `bug`.

**The tags that exist are the tags on the cards.** There is no tag table and no registry.
`BoardDb.listTags()` derives the inventory in SQL for bridge-side consumers; `tagsOf(cards)` derives
the same list from the cards a screen already holds, so the client needs no extra request.

## Consequences

- Two tags can draw the same hue — with twelve bands it is visible from about five tags. Accepted:
  the fix is assigning colours in inventory order, which makes a tag's colour depend on what else
  exists on that board at that moment, and the single property this design is FOR is that it doesn't.
- Nobody can choose a tag's colour. Renaming the tag is the only way to change it.
- A tag exists only as long as a card carries it: retag the last card and the word is gone from the
  inventory. That is the intended behaviour of a derived list, and it is why there is no separate
  place to prune.
- **What would justify revisiting the cardinality:** cards that genuinely belong to two axes at once
  (say a "backend" *and* a "release-blocker"), asked for by someone actually triaging on the phone.
  The upgrade is additive — a `card_tag` table seeded from this column — and nothing above needs
  un-inventing to get there. A second axis is more likely to be a second FIELD than a second tag.
- **A card the copilot files does not spend its tag on provenance** — the question re-opened on
  2026-09-01 and answered by looking. The review's follow-ups say where they came from in three
  fields of their own (`origin`, `originCardId`, `category`), and their tag stays the AREA: the
  copilot proposes one under `tagRule`, and `CopilotCoordinator.review` falls back to the reviewed
  card's tag when it doesn't (`bridge/copilot.ts`). On the live board every `origin = 'copilot'` card
  carries a real area tag — `notifications`, `gameplay`, `structure`, `docs` — and none carries a
  provenance word. The two axes compose rather than compete: `matchesFilters`
  (`web/src/lib/board.ts`) ANDs the tag with the Source strip's `autoOnly`, so a generated card is
  found under its area exactly like a hand-written one. Covered by the two follow-up tests in
  `bridge/board.test.ts` ("tags a review follow-up…", "categorises every review follow-up…").
