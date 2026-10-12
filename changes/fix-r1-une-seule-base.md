bump: patch

### Changed
- Diff vide : plus de bouton « Base ref sur main »

### Fixed
- Base d'une carte : une seule résolution (`baseOf`), la branche par défaut du dépôt, jamais la branche courante du checkout principal
- Toute carte naît avec sa `baseRef` (copilot et cartes dépendantes comprises) ; les anciennes lignes à `NULL` sont remplies une fois au démarrage
- Diff, revue, intégration, bilan et artefacts lisent la même base
