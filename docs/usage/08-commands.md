# Commands

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Every command works two ways: the **control script** on the host (`scripts/collie-board-ctl.sh <cmd>`) or
the equivalent **Herdr action** (`herdr plugin action invoke <cmd> --plugin herdr.collie-board`, written
below as `invoke <cmd>`). The ones you'll actually use:

| Action | Control script | Herdr action |
| --- | --- | --- |
| **Start** — build if needed, serve, print the URL | `collie-board-ctl.sh start` | `invoke start` |
| **Stop** — pause the bridge; removes nothing | `collie-board-ctl.sh stop` | `invoke stop` |
| **Restart** | `collie-board-ctl.sh restart` | `invoke restart` |
| **Status** — the *Collie is running* banner + URLs | `collie-board-ctl.sh status` | `invoke status` |
| **URL** — print the tailnet URL | `collie-board-ctl.sh url` | `invoke url` |
| **Version** — the running version (`0.x.y+sha`) | `collie-board-ctl.sh version` | `invoke version` |
| **Update** — advance the checkout + rebuild + restart | `collie-board-ctl.sh update` | `invoke update` |
| **Uninstall** — remove the service; keep `.env` + checkout | `collie-board-ctl.sh uninstall` | `invoke uninstall` |
| **Logs** — tail the journal / log file | `collie-board-ctl.sh logs` | — (script only) |

`start` and `status` end with the **Collie is running** banner — annotated line by line in
[First run](../../README.md#first-run--what-youll-see). Its version comes from the *served* bundle stamp, so it's
the authoritative "what's running" — note `herdr plugin list --json` shows a different value cached
at `plugin link` time; for a linked clone `update` re-links automatically so that self-heals (to
force it: `herdr plugin link "$(pwd)"`), and on Herdr ≥0.8.0 the manifest is re-read from disk
anyway. **Through a Herdr action you get Herdr's JSON envelope, not the
banner** — the human-readable output is the action's *captured stdout*, read with
`herdr plugin log list --plugin herdr.collie-board` (or run the control script directly to see it inline).
`build` · `serve` · `unserve` are script-only too.

## Herdr actions

Collie registers these actions in `herdr-plugin.toml`; invoke any with
`herdr plugin action invoke <id> --plugin herdr.collie-board` (list them live with
`herdr plugin action list --plugin herdr.collie-board`):

| `<id>` | Title | What it does |
| --- | --- | --- |
| `setup` | Set up (preflight + config) | Preflight, link the plugin, derive the two security settings. Starts and publishes nothing |
| `start` | Start web bridge | Build if needed, start the service, `tailscale serve`, print URL + banner |
| `stop` | Stop web bridge | Pause the bridge; removes nothing |
| `restart` | Restart web bridge | `stop` + `start` |
| `status` | Bridge status | The *Collie is running* banner — readiness ✓/⚠, version, URLs |
| `url` | Show bridge URL | Print the tailnet URL |
| `version` | Show version | Print the running version (`0.x.y+sha`) |
| `update` | Update plugin | Advance the checkout (pull, or fetch + re-detach) + rebuild + restart |
| `uninstall` | Uninstall web bridge (remove service) | Tear down the service (keeps `.env` + checkout) |
