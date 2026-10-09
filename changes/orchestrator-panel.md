bump: minor

### Added
- Panneau « orchestrateur » dans la vue projet : un agent par dépôt, démarré sur ton tap, qui planifie phases, lots et roadmap sans jamais lancer (ADR 0021)

### Fixed
- `/api/phases`, `/api/roadmap` et `/api/runs/:id` n'étaient pas transmis au board par le serveur (ils répondaient la page HTML)
