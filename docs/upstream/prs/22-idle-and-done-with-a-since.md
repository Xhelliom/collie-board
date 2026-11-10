# 22. 🔵 `idle` and `done`, with a since

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

A settled pane says *what* it is and never *since when*. On the triage screen that is the whole
question: a session that finished thirty seconds ago and one that has been sitting there since
lunch are the same grey word, so the list gives no reason to look at one before the other.

| | |
|---|---|
| Commit | _(this change)_ |
| Files | `bridge/state-engine.ts` (a `statusSince` map + three lines in the poll), `bridge/types.ts` · `web/src/lib/types.ts` (`AgentView.statusSince`), `web/src/components/agent-card.tsx` (+ test), `bridge/state-engine.test.ts` |
| Extraction | **Clean cherry-pick.** No card in sight — the poller, the pane type and the pane row are all upstream's. |

**The poller already knows.** It diffs each pane's status against the previous tick to fire
transitions; stamping `Date.now()` on the same edge costs a `Map` and no extra call. The age then
rides the snapshot every client already polls, so it needs no timer and no second source.

**A pane first seen already `done` carries no stamp.** The bridge did not witness that switch, and
the honest rendering of an unknown instant is nothing at all — a fresh `just now` on an agent that
finished three hours ago is precisely the wrong reading, and the one the operator would act on. It
appears at the pane's next real transition. Same rule the transition listeners already follow (a
first sighting never notifies), and the stamp is dropped with the pane so a reused id starts clean.

**Only `idle` and `done`.** `working` has a live spinner, `blocked` is the thing you are already
being sent to; neither is waiting to be ranked by age. Rendered through the existing `timeAgo()`,
next to the state rather than in a column of its own — a footnote on the word, at the same weight
as the rest of the metadata line.

---
