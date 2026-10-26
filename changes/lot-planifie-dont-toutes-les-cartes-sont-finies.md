bump: patch

### Fixed
- Un lot planifié dont toutes les cartes sont `done` se montre « terminé hors lot » : plus de « Lancer », l'autonomie ne le choisit plus, `POST /api/runs/<id>/launch` le refuse (409) et la fin de phase le compte comme fini
