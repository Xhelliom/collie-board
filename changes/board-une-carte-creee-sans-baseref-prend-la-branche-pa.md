bump: patch

### Fixed
- `POST /api/cards` sans `baseRef` prend la branche par défaut du dépôt (plus `null`, qui vidait le diff de review) ; le skill dit d'envoyer `baseRef`
