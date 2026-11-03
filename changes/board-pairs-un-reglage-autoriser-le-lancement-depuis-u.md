bump: minor

### Added
- Pairs : « Autoriser » par environnement et par pair — le droit de lancer, les conditions affichées avec leur état
- « Lancer sur » d'une carte : un pair joint sans environnement utilisable dit pourquoi (aucun environnement, origine, lancement non accordé)
- Un lancement depuis un pair pré-accepte la confiance Claude Code du worktree

### Changed
- Un lancement depuis un pair ne dépend plus de l'autonomie du dépôt : le droit accordé suffit (ADR 0051)

### Fixed
- Démarrage sur un pair : la requête n'est plus coupée à 10 s (502 alors que l'agent tournait)
- Démarrage sur un pair idempotent : un nouvel essai réutilise le worktree existant et garde l'agent qui y est
- node.toml modifié à la main est pris sans redémarrage
