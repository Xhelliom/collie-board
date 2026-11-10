# 36. 🟡 Long lists fold to their newest few, with a « Voir les n autres » toggle

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

`useFold(items, limit)` + `FoldToggle`: a list that grows with use (Idle · done) shows its first
`limit` entries and a counted toggle for the rest. Generic — it knows no card.

| | |
|---|---|
| Commit | `1cfc6f8e` *Replis : Idle · done, Projets, fichiers du diff, colonne Terminé, boîtes de texte du projet* (the upstream half only) |
| Files | `web/src/components/fold.tsx` (+ test), `web/src/components/agent-list.tsx` (`IdleList`), the `fold.more`/`fold.less` strings in `web/src/i18n/messages/common.ts` |
| Extraction | **Needs a filter**: the commit also folds fork-only screens (board column, project, diff, dashboard); keep the three files above. |

---
