bump: minor

### Added
- Lot : réglage `integration: "lot"` — les cartes se replient dans une branche de lot et le lot ouvre UNE PR (une CI) ; `card` reste le défaut
- `PATCH /api/runs/<id>` et `POST /api/runs` posent `integration` ; `GET /api/cards/<id>/pr` d'une carte du lot renvoie la PR du lot (ADR 0041)

### Changed
- Le nettoyage supprime la branche d'une carte déjà contenue dans sa base même si la base n'est pas HEAD
