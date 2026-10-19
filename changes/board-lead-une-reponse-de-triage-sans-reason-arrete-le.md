bump: minor

### Added
- `POST /api/runs/<id>/resume` : l'opérateur reprend un lot arrêté là où il s'est arrêté (un triage est redemandé, le worker n'est pas relancé)

### Fixed
- Réponse mal formée du lead (champ manquant, JSON invalide) : redemandée deux fois avec l'erreur avant d'arrêter le lot, en disant ce qui manque
