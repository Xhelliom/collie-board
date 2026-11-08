# 15. 🔵 A reading mode for the pane screen (and the `after` cursor it needs)

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

The mirror is double-wrapped and always was: herdr hands us the pane already cut to the terminal's
columns (~81), and the phone then wraps that again at ~50 — so every paragraph of agent prose breaks
twice, the second time mid-sentence. **No wrap setting can fix it**, because the first cut is in the
bytes before Collie sees them. The agent's own transcript was never cut, and Collie already reads it.

| | |
|---|---|
| Commits | `c9a2a32` *feat(transcript): an `after` cursor…* · `73f43f5` *feat(pane): a reading mode…* · *fix(reading): the queue drains at a turn end; queue, thinking and tool runs fold* |
| Files | `bridge/transcript.ts` (`pageEntries`), `bridge/server.ts` (`historyParams`), `web/src/lib/{api,markdown}.ts`, `web/src/components/{reading-view,markdown-text,agent-chat}.tsx`, `web/src/hooks/use-display-prefs.ts` (+ their tests) |
| Extraction | **Clean cherry-pick.** Every file is upstream's or a new one; no card is in sight, and the two commits are already split along the seam (the cursor, then the view that uses it). |

**The `after` cursor** is the piece worth taking even alone. `pageEntries` only ever walked backwards,
which is *why* upstream's history route opts out of the poll loop: following a conversation meant
re-downloading the archive per tick. `after` is the symmetric direction — the turns written since one
the caller holds — with the same cap, the same opaque uuid cursor, and the same "an unknown cursor
degrades to the newest page, never to an empty one". ~15 lines and it makes a live transcript view
affordable at all.

**The mode.** One toggle in the pane header: `[terminal] [reading]`, persisted per device with the
other display prefs. Terminal is untouched — native dialog buttons, key grammars, statusline, the
stranded-draft preview. Reading renders the last 40 turns through the existing transcript view. Not a
second screen: the composer, statusline and gauge sit below both, so replying never means leaving the
thing you were reading.

**The one hazard, handled.** A TUI dialog exists *only* in the TUI, so a reader could otherwise sit
watching an agent that is actually blocked behind a question. Reading mode banners it (`dialogPresent`
is already derived every render for the composer's send guard) and the banner is the button back to
terminal. This is the part to keep if anything else is cut.

**No new poll loop.** The tick is the pane poll's own heartbeat (the router revalidator settling back
to `idle`); a tick that finds nothing costs an empty array. The fetch deliberately re-asks from the
*second*-newest turn, because a tool result lands by mutating the turn that made the call — so the
newest turn we hold can still change after we've seen it.

**Do not use `revision` as the heartbeat** — the trap this shipped with, and upstream would hit it the
same way. `pane.read`'s `revision` is a STUB on herdr 0.7.x: 0 for every pane, always, including
actively-changing ones (`HERDR_API.md` says so, and it is still true on 0.7.5). A revision-driven view
fetches once at mount and then silently stops, which reads as an agent going quiet.

**A draft on the terminal's input line is shown at the tail of the thread**, dashed and named "Draft
in terminal · not sent" — it is in no log, so without it the thread reads as though you never wrote
the message you typed while the agent was busy. It comes from `extractInputDraft`, the value the
composer already surfaces, so the two never disagree. A *queued* message is a different state and
deliberately NOT shown as a draft: Claude Code clears the line and paints "Press up to edit queued
messages", so its text is nowhere in the mirror.

**Markdown tables**, in the same brick because it's the same complaint. `lib/markdown.ts` gained a
`table` block (headers plus rows normalised to the header's column count, escaped pipes respected);
the renderer picks the shape from the column count — a scrollable `<table>` up to three columns, one
labelled card per row beyond it, because four columns on a 360px screen is a horizontal pan. Cells
stay `MdSpan[]` rendered as React elements, so **the XSS boundary does not move** and no
markdown→HTML dependency is added.

**Folded by default**, so the prose is what's on screen: a run of ≥2 tool-only/thinking-only agent
turns becomes one "N steps" line, thinking and the compaction summary fold, and so does the Queue. A
find query, or a jump landing inside, unfolds them. The queue itself is replayed from the log's
`queue-operation` rows, which is **not a faithful FIFO** (a restart drops ops): a completed turn
(`system/turn_duration`) resets it, and `remove` drops the item it names rather than the front.

---
