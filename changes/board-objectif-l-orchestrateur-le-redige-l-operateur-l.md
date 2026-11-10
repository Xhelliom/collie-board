bump: minor

### Added
- Objectif : l'orchestrateur peut l'écrire lui-même sur l'accord oral de l'opérateur (`POST /api/goals` depuis un pane), marqué « écrit par l'orchestrateur » (ADR 0057)
- Bouton `set_goal` dans un bloc `collie-buttons` : montre texte et critères, confirme en deux appuis, crée l'objectif

### Changed
- Un pane agent peut modifier texte, critères et budget d'un objectif en attente ou actif écrit par un pane ; pause, reprise, validation, abandon, démarrage et suppression restent à l'opérateur
