bump: minor

### Added
- « Nouveau terminal » : choix de l'espace herdr-app (« Collie Board » par défaut), grisé avec sa raison sous herdr 0.9
- Après l'ouverture, un encadré dit où trouver le terminal (herdr-app ou herdr 0.9) et pourquoi en cas de repli, avec « Ouvrir dans Collie »
- Vue d'un terminal : l'en-tête dit le moteur et l'espace/onglet où le retrouver (orange s'il est invisible dans herdr-app)

### Changed
- `POST /api/project/open` renvoie `engine`, `fallback` et `place` (espace, onglet) ; accepte `space`
