# 46. 🟡 AskUserQuestion — the whole question, and its free-text row

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Claude Code 2.1.322 draws a question that wraps behind a `│ ` gutter, and only its last row carries
the « ? »: `findQuestion` returned that row alone, so the lifted dialog lost the start of the
question. The wizard looked for its stepper 10 rows up at most, so a long question on a narrow pane
fell through to the single-question grammar. And « Type something. » was dropped on the promise
that the composer covers it — which the composer has refused since the dialog guard. The row is now
`freeText` on the model and an input in the card: digit → pointer verified → text → Enter. Generic —
no card in sight.

| | |
|---|---|
| Commit | *fix(lecture): question d'un AskUserQuestion entière, et sa saisie libre* |
| Files | `web/src/lib/harness/claude/prompt-select.ts`, `wizard.ts`, `web/src/lib/free-text-action.ts` (new), `components/option-button.tsx` (`FreeTextRow`), `prompt-select-block.tsx`, `wizard-block.tsx`, `blocked-screen-banner.tsx` (`screenTail`), fixtures `claude--v2322-*.txt` (+ tests) |
| Extraction | **Needs extraction**: leave the bridge half (`sendPaneLine`, `force` on `/reply`) — it exists for the hc engine; on herdr `sendReply(text, true)` is enough. |
