# 40. 🟡 Which agents have subagents running

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Claude Code's background subagents leave nothing on the pane: the main agent goes idle while they
work. `bridge/subagents.ts` reads them off the session log the gauge already loads — a `tool_use`
"Agent" started (`toolUseResult.status` `async_launched`/`forked`) with no `<task-notification>`
naming its `tool-use-id` yet, and nothing before the newest `cost-state` row (the session exited).
Verified on 600 real logs (Claude Code 2.1.286–2.1.304) and live. Claude panes only. Shown as one
line, « N sous-agents en cours · descriptions », on every pane tile and under the pane header.

| | |
|---|---|
| Commit | *Sous-agents en cours : visibles sur la tuile de l'agent et sous l'en-tête du pane* |
| Files | `bridge/subagents.ts` (+ test, new), `bridge/context.ts` (read + `enrich`), `bridge/types.ts` · `web/src/lib/types.ts` (`AgentView.subagents`), `web/src/components/subagents-line.tsx` (new), `agent-card.tsx`, `agent-chat.tsx`, `i18n/messages/pane.ts` |
| Extraction | **Needs extraction**: it rides on `ContextTracker`, which upstream lacks — upstream would call `runningSubagents()` from wherever it reads the transcript, at that cadence. |

---
