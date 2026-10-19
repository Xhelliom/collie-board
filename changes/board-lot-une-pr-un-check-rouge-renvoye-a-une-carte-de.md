bump: patch

### Fixed
- Lot « une PR » : une carte déjà repliée dans le lot n'est plus mesurée vide contre la branche de lot — plus d'arrêt « no commit » ni de boucle working↔review « review refused »
- Lot « une PR » : un check rouge où le worker ne trouve rien à corriger arrête le lot comme échec d'infra, et la PR du lot est fusionnée dès que le check repasse au vert
