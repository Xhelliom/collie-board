# 7. ⚪ Diff view on the focused pane's `cwd`

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `6bce9cc` |
| Files | `bridge/git.ts`, `web/src/components/card-diff.tsx` |
| Extraction | **Needs splitting and rewriting.** `git.ts` is scoped by a card's branch; upstream would scope it by the focused pane's `cwd` + its current branch. The parsers (`parseNumstat`, `parseUntracked`, `isSafeDiffPath`) transfer as-is. |

Reading a diff on a phone is missing for everyone, and needs no card. Worth noting the two choices:
diff the **working tree** against the merge base (agents routinely leave nothing committed, so
`base...HEAD` reads empty), and list untracked files separately (`git diff` cannot see them, and a
new file is the most common thing an agent produces).

Check `persiyanov/herdr-reviewr` before proposing — it may already cover this.

---
