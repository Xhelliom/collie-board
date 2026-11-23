bump: minor

### Added
- `GET /api/health` : lots ouverts (âge, dernier événement, cartes arrêtées/orphelines et raison, orchestrateur vivant), cartes muettes > 45 min, gates en échec sur 24 h, 5 routes les plus lentes, uptime et dernière déconnexion herdr — du plus grave au moins grave.
- L'orchestrateur est invité à commencer sa ronde de santé par cette route.
