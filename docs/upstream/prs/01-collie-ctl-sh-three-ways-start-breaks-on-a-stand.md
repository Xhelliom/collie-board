# 1. 🔵 `collie-ctl.sh` — three ways `start` breaks on a standard install

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

**The first PR to offer.** Pure bug fix, no board dependency, hits every user, and it is one commit.

| | |
|---|---|
| Commit | `1952610` *fix(ctl): three ways `start` broke on a completely standard install* |
| Files | `scripts/collie-ctl.sh`, `scripts/collie-ctl.test.sh` |
| Extraction | **Clean cherry-pick.** Only the filename differs (`collie-board-ctl.sh`), so the pick needs `-X rename-threshold` or a manual path fix. |

What it fixes, all live-reproduced:

1. **`start` dies with "bun not found" while `bun --version` works.** Herdr runs plugin actions in a
   non-interactive shell, which sources no `~/.zshrc` — so the `~/.bun/bin` entry bun's own
   installer writes there isn't in scope. Resolution now also checks `$BUN_INSTALL/bin`,
   `~/.bun/bin`, `/usr/local/bin`, `/opt/homebrew/bin`.
2. **`BUN="$(resolve_bun)"` under `set -e`** — a command substitution returning non-zero in an
   assignment kills the script, so a machine with no bun exited silently before reaching the message
   explaining what to do.
3. **`tailscale status --json | bun` under `pipefail`** — the pipeline inherits *tailscale's* exit
   code, so a tailscale that is installed but not connected took the whole script down instead of
   degrading to "unknown".

Plus: the `serve` failure now reports what tailscale actually said. It used to blame a missing
certificate unconditionally, which sends someone hitting the `--operator` permission to exactly the
wrong fix.

---
