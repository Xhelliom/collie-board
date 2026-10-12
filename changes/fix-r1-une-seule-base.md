bump: patch

### Changed
- Diff vide : plus de bouton « Base ref sur main »

### Fixed
- Base d'une carte : une seule résolution (`baseOf`), la branche par défaut du dépôt, jamais la branche courante du checkout principal
- Dépôt sans `origin/HEAD`, `main` ni `master` : pas de base devinée ni persistée (jamais une branche `board/…`), ses cartes sont sautées par le back-fill
- Toute carte naît avec sa `baseRef` (copilot et cartes dépendantes comprises) ; les anciennes lignes à `NULL` sont remplies une fois au démarrage
- Diff, revue, intégration, bilan et artefacts lisent la même base
