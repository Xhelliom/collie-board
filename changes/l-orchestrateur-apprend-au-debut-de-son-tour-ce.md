bump: minor

### Added
- `GET /api/orchestrator/since?since=<ts>` : ce qui a bougé dans le dépôt sans l'orchestrateur (gestes audités hors son pane, PR mergées ou fermées), pour son seul pane.
- Hook Claude Code `UserPromptSubmit` (`skills/collie-board/since-hook.sh`) qui l'injecte au début de chaque tour, muet quand rien n'a bougé ; installation et consigne sans hook dans SKILL.md.

### Changed
- L'audit des routes du board porte le pane appelant ; la suppression d'une carte, d'une phase ou d'un lot y garde son dépôt et son nom.
