# 38. 🔵 The transcript's timestamps reuse one formatter

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

`clockTime`/`dayKey` called `toLocaleTimeString`/`toLocaleDateString`, which build a fresh Intl
formatter on every call — twice per turn, on every poll that re-renders the conversation. Measured on
a 40-turn transcript at 1.5 s polling, phone throttling (CPU ×4): ≈ 450 ms of main thread per 12 s,
a third of React's render phase. Two module-level `Intl.DateTimeFormat`, same options, same output.
Generic — it knows no card.

| | |
|---|---|
| Commit | *Transcript : un formateur de date par module, plus un par tour et par poll (audit perf #8)* |
| Files | `web/src/components/transcript-view.tsx` |
| Extraction | **Clean cherry-pick**. |

---
