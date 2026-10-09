bump: minor

### Added
- Barrière par dépôt : une commande de l'opérateur lancée sur chaque retour d'un worker avant le lead ; rouge, le worker est renvoyé sans solliciter le lead (ADR 0020)
- `POST /api/repos/gate` pour la définir, `gate` dans `GET /api/repos`, ligne `run.gate` dans le journal
