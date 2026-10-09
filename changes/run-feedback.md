bump: minor

### Added
- Plafond de parallélisme par lot (`maxParallel`, 1 = séquentiel), fixé par l'orchestrateur à la planification

### Fixed
- Run : une carte sans `baseRef` se lisait contre `HEAD`, donc le travail commité paraissait vide au lead qui renvoyait le worker pour rien
