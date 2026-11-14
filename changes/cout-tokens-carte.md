bump: minor

### Added
- Fiche carte : « Consommé » — tokens (entrée, sortie, cache écrit/lu) par modèle sur toutes les sessions
- `GET /api/cards/:id/cost` ; « inconnu » pour un agent non vérifié

### Fixed
- Consommé : « partiel, 2/3 sessions » quand une session n'a pas de chiffre (plus de total bas présenté comme complet)
- Consommé : le transcript est re-résolu quand l'agentSessionId d'une session change
- Consommé : un transcript tronqué (>32 Mo) compte comme non compté — « partiel », jamais un total plancher
