# 5. 🔵 Wrap the pane mirror by default on a phone

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Tiny, one file, and it fixes the primary screen of a phone-first app.

| | |
|---|---|
| Commit | `9fa4248` *fix(web): wrap the mirror by default on a phone* |
| Files | `web/src/hooks/use-display-prefs.ts` |
| Extraction | **Clean cherry-pick.** |

`DEFAULTS.wrap` is `false`, so the mirror pans horizontally out of the box. Measured on a real herd:
panes run a **median of 81 columns and a max of 233**, while a phone shows about 50 at 12px
monospace — so most lines run off the edge, on the one screen Collie exists for.

Not wrap-always: the no-wrap default is *right* on a wide screen, where preserving column alignment
is what makes a TUI's boxes and tables readable at all. So the default follows the viewport
(`wrapDefaultFor`, < 640px = the app's own `max-w-screen-sm`), and the instant the user touches the
existing toggle their choice is stored and wins forever. Nothing else changes.

---
