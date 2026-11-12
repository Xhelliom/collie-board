bump: minor

### Added
- Réglages du dépôt : provider / modèle / effort par défaut pour chaque harnais (Claude, OpenCode), choix lus dans leurs fichiers locaux.
- OpenCode : le défaut du dépôt démarre les cartes via un opencode.json écrit à côté des worktrees (le TUI n'a pas de --model).

### Changed
- `/api/repos/model` par harnais (`kind`) ; l'ancien réglage Claude est migré tel quel.
