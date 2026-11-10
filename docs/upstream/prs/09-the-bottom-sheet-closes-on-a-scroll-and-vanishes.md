# 9. 🔵 The bottom sheet closes on a scroll, and vanishes instead of closing

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `5151295` *fix(sheet): a drag in a list no longer closes the drawer, and closing is animated* |
| Files | `web/src/components/ui/sheet.tsx`, `web/src/components/ui/sheet.test.tsx` |
| Extraction | **Clean cherry-pick — from `5151295` only.** The file has since been rewritten over Vaul ([ADR 0003](../../../.adr/0003-vaul-owns-the-sheet-gesture.md)), so offer that commit, never the current file: upstream has not taken that dependency and this brick must not smuggle it in. |

Every Collie user on a phone hits this: a drag down inside a sheet's list closes the sheet instead
of scrolling it, reopening one flickers, and closing is a hard cut with no animation. Three separate
causes, all in the hand-rolled sheet (upstream doesn't use Vaul either): the pull-to-dismiss arms on
any touch — including one that starts in a field or a scroller; the drag offset survives the close
and replays on the next open; and `onClose` sits in the effect dependency arrays, so every caller's
inline lambda re-attaches the listeners on each parent render. The `onClose` fix belongs in the
component rather than in `useCallback`s at the call sites — that is what stops the next caller from
reintroducing it.

---
