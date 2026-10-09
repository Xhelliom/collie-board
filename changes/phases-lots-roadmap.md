bump: minor

### Added
- Phases, lots (runs planifiés) et roadmap par dépôt : tables `phase` et `roadmap`, `card.phase_id`, `run.phase_id/name/position/launched_at` (ADR 0021)
- Routes `/api/phases`, `/api/runs` (GET, PATCH, DELETE, `planned`), `POST /api/runs/:id/launch`, `/api/roadmap` (révision optimiste, export Markdown `format=md`)

### Changed
- Un lot planifié ne pilote rien tant qu'il n'est pas lancé ; une requête portant `x-collie-pane` ne peut pas lancer un run (403)
