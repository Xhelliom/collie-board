bump: minor

### Added
- Un lot arrêté affiche sa raison et un bouton « Reprendre » (`POST /api/runs/<id>/resume`)
- `GET /api/runs` : champ `halted` (raison de l'arrêt qui tient encore, `null` sinon)
