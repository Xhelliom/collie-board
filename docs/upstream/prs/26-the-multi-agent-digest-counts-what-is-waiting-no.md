# 26. 🔵 The multi-agent digest counts what is waiting, not how many agents

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

Upstream's digest headline counts the one field that is the same word on every pane: `3 agents done`
tells you a number of workers and nothing about what they left behind. Brick 24 already made the
*body* say the subjects; the title kept counting agents. It now counts **states**: `1 question,
2 done` — questions first, because a blocked agent is stalled on an answer only you can give and a
finished one is not. Fixed order, not sorted by size, so the headline doesn't reshuffle itself on a
lock screen every time one alert resolves.

| | |
|---|---|
| Commit | `b9603b1` *feat(notify): the digest counts states, not agents* |
| Files | `bridge/notify-content.ts` + its byte copy `web/src/lib/notify-content.ts` (the marker split out of `notifyContent` as `notifyMarker`), `bridge/notifications.ts` (`summarize`'s digest branch, ~12 lines) |
| Extraction | **Clean cherry-pick**, and it needs bricks 24 and 25 first. The board only shows through one marker (`Review`, for a card the board moved there), which falls through to `Done` when there is no card — upstream's only case. |

**The count reads the same rule as a single alert's title.** `notifyMarker` is the marker function
`notifyContent` already used inline; the digest calls it and groups by its result, so a digest and
the notifications it collapsed can never disagree about which state one of them was in. The *words*
differ ("1 Needs you" is not a sentence), the rule does not.

**A state with nothing in it is not mentioned.** A uniform herd reads `3 done`, exactly as short as
what it replaces, and strictly more informative.

---
