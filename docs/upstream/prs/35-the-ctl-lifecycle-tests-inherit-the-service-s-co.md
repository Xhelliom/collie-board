# 35. 🔵 The ctl lifecycle tests inherit the service's config

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

A push made by the bridge runs the pre-push hook, and so this suite, with the systemd unit's
environment — `.env` included. An inherited `COLLIE_BOARD_TRUSTED_USER` masked what `setup` derives
and failed the push. The suite now unsets every `COLLIE_BOARD_*` / `HERDR_*` before it starts.

| | |
|---|---|
| Commit | *test(ctl): the lifecycle suite no longer inherits the service's config* |
| Files | `scripts/collie-board-ctl.test.sh` |
| Extraction | **Clean cherry-pick**, `COLLIE_BOARD_` → `COLLIE_` in the pattern. |

---
