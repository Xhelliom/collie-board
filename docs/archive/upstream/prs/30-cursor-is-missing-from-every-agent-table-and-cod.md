# 30. 🔵 Cursor is missing from every agent table, and Codex's reset command is wrong

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `26a78bb` *feat(agents): cursor in both agent tables, and codex's real reset command* |
| Files | `web/src/lib/agent-commands.ts` (+ test), `web/src/components/agent-icon-data.ts`, `web/src/components/agent-icon.tsx` (+ test), `adapters/agents.toml`, `bridge/adapters.ts` (+ its block in `bridge/board.test.ts`) |
| Extraction | **Clean cherry-pick for the frontend half** — `agent-commands.ts` and `agent-icon-data.ts` are upstream files and the change is pure data, no card in sight. The `adapters/` half only applies upstream alongside brick 8. |

**herdr accepts `--kind cursor` and ships a dedicated integration, but Cursor was in neither table.**
`commandsFor("cursor")` returned `[]`, so the UI *hid* the command button — a Cursor pane loses the
palette entirely, and on a phone that palette is one of the few comfortable ways to drive an agent
with no keyboard. The icon fell back to a "CU" initials tile on every card and in the sidebar.

**The reset commands are opposites, which is why guessing failed.** Codex resets with `/new`;
`/clear` also starts a new chat but wipes the terminal with it. Cursor has no `/new` at all —
`/clear` *is* its reset. Anything that assumed one convention was going to be wrong for the other.

**Sourced from the enum, not the prose.** `codex-rs/tui/src/slash_command.rs` is what the command
popup is built from, so it is the only list that cannot drift from the shipped binary. Checking the
existing catalog against it found `/fast` gone, `/agent` renamed to `/agents` (with `/subagents`
split off), and ten commands missing.

---
