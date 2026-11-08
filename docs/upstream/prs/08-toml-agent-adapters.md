# 8. ⚪ TOML agent adapters

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `c0bca59` |
| Files | `bridge/adapters.ts`, `adapters/agents.toml` |
| Extraction | **Nearly clean.** The module has no board dependency; only its consumers do. |

Four fields — launch kind, context-reset command, whether the transcript is readable, whether a
native session id is reported — merged **per field** from a user file. Only useful to upstream
alongside brick 2 or 4; on its own it configures nothing.

---
