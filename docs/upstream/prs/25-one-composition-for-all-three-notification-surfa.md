# 25. 🔵 One composition for all three notification surfaces

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

Brick 24 fixed the push. Upstream renders the same facts **three times, from three different codes**:
the push (`notifications.ts`), the in-app toast (`use-transitions.ts`) and — here — the bell. Each
composes its own sentence at its own level of richness, so improving one improves nothing else, and
the push, the only surface that counts with the phone in a pocket, was the poorest of the three.
Concretely: after brick 24 a lock screen read `Done · webapp` while the toast for the same event
still read `claude is done · webapp`.

| | |
|---|---|
| Commit | `e79fe29` *feat(notify): the toast and the bell speak the push's sentence* |
| Files | `web/src/lib/notify-content.ts` (new — a byte copy of `bridge/notify-content.ts`), `web/src/hooks/use-transitions.ts` (one call replaces the toast's own sentence), `web/src/lib/types.ts` (`notifyVerb`/`notifyWhere`/`notifyWhat` deleted), `bridge/notifications.ts` (`summarize`'s digest body), `bridge/notify-content.ts` (an optional `session`, and `basename` inlined so the file has no imports) |
| Extraction | **Clean cherry-pick**, and it needs brick 24 first. Nothing in it knows the board exists: with no card the subject falls through to the repo, which is upstream's only case. |

**The copy is checked, not trusted.** The bridge and the web app build from separate source trees on
purpose, which rules out an import across the boundary — the trade upstream already makes for
`paneDisplayName`. What is new is that a test diffs the two files and fails the build the moment they
drift, so "one composition" survives the next edit instead of being a comment that used to be true.

**The digest stops naming panes.** `claude, claude, claude` used the one word herdr reports for every
pane. It lists the subjects now, deduplicated — the count is already in the title, so a repo with two
alerts says its name once.

**What the in-app surfaces add is one optional field.** The herd session, when it isn't the primary
one: a history row and a toast have room to say where to go look, a lock screen does not. One
parameter, not a second composition.

**One deletion falls out of it.** `notifyVerb` ("needs you" / "is done") and its two siblings handed
out the words for a sentence each caller then assembled. With the sentence itself shared, all three
go.

---
