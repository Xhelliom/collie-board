bump: minor

### Added
- Mode objectif : un objectif actif réveille l'orchestrateur en fin de lot pour planifier la suite, et le laisse lancer ses lots, un à la fois
- Une borne du budget (lots, quota, échéance, rouge) met l'objectif en pause et prévient l'opérateur une fois
- Valider l'objectif clôt les phases découpées pendant celui-ci
- Page projet : refuser un objectif déclaré atteint, avec un commentaire qui renvoie l'orchestrateur au travail

### Changed
- Objectif déclaré atteint : arrêt net — plus de lot créé ni lancé, plus de réveil, jusqu'à la réponse de l'opérateur
- Les lots planifiés et les phases créés pendant l'objectif lui sont rattachés
