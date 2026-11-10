# 10. 🔵 Three one-line finishes: `text-wrap`, scroll-snap, haptic confirm

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `160007d` *feat(board): the one-line finishes — text-pretty, scroll-snap, haptic arm* |
| Files | `web/src/index.css`, `web/src/components/{space,tab,pane}-strip.tsx`, `web/src/hooks/use-pending-confirm.{ts,test.ts}` |
| Extraction | **Clean cherry-pick.** Every file is upstream's; no card is in sight. |

Three unrelated polish items that happen to be one line each. A global `text-wrap: pretty` / `balance`
rule removes orphan words app-wide (`pre` untouched, so the mirror never rewraps). The three
horizontal chip strips get `snap-x snap-mandatory` + `[&>*]:snap-start` + `scroll-px-3`, so a flick
lands on a chip instead of half-cutting one at the edge. And arming a two-tap confirm calls
`navigator.vibrate?.(10)` from inside `usePendingConfirm`, which every destructive action already
routes through — Android gets the tick, iOS Safari and jsdom no-op on the optional call.

---
