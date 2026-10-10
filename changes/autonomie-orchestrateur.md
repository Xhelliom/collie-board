bump: minor

### Added
- Réglage par projet : l'orchestrateur peut lancer le lot planifié suivant à la fin d'un lot (défaut : off, ADR 0030)
- Bornes par projet : lots enchaînés sans l'opérateur (1 à illimité, défaut 1) et arrêt sur gate/CI rouge (défaut on)
- `PUT /api/orchestrator/autonomy` : réservé à l'opérateur (403 avec `x-collie-pane`)
