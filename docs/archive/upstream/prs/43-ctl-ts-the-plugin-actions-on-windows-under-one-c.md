# 43. 🟡 `ctl.ts` — the plugin actions on Windows, under one command per id

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Upstream's manifest declares `linux`/`macos` only, because every action is `bash
scripts/collie-ctl.sh`. Herdr refuses two actions with one id even with disjoint `platforms`
(`duplicate_plugin_action_id`, measured on 0.9.5), so the actions Windows offers become
`bun scripts/ctl.ts <id>` everywhere: a transparent hand-off to the shell script on Linux/macOS, a
native implementation on Windows — build, start/stop/restart/uninstall (a scheduled task at logon,
not elevated, with a restart-on-death supervisor), status, url, version, logs. `setup`/`update`
stay bash, Linux/macOS only. Plus `* text=auto eol=lf` in `.gitattributes` and `tsc` instead of
`bunx tsc` (winget's Bun has no `bunx`). Generic — no card in sight.

| | |
|---|---|
| Commit | *feat(windows): herdr plugin install natif — scripts/ctl.ts, tâche planifiée à l'ouverture de session* |
| Files | `scripts/ctl.ts` (+ test, new), `herdr-plugin.toml`, `.gitattributes`, `package.json` (`typecheck`), README « Windows », ARCHITECTURE §3, ADR 0050 |
| Extraction | **Needs extraction**: file names (`collie-board-ctl.sh`, `herdr.collie-board`, the `CollieBoard` task) and the fork's pane-fixture path in `.gitattributes`. The ADR is the fork's numbering. |
