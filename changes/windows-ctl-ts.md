bump: minor

### Added
- Windows : `herdr plugin install` marche nativement — `scripts/ctl.ts` sous Bun (build, start/stop/restart, uninstall, status, url, version, logs), sans Git Bash
- Windows : le bridge tourne dans une tâche planifiée à l'ouverture de session (session de l'utilisateur, non élevée, jamais un service), qui le relance s'il meurt

### Changed
- Les actions start/stop/restart/uninstall/status/url/version passent par `bun scripts/ctl.ts` sur toutes les plateformes ; sous Linux/macOS il délègue à `collie-board-ctl.sh` — `bun` doit être dans le PATH du serveur herdr (ADR 0050)
- `.gitattributes` : tout le texte en LF quel que soit `core.autocrlf`, sauf les captures de panes
