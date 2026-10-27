bump: minor

### Added
- Carte : champ `environment` ({peer, name}, null = local) ; son lancement part sur le pair (`/api/node/launch`), jamais en local à la place
- Refus motivés et journalisés avec le pair : pair injoignable ou non appairé, environnement inconnu, autonomie coupée
- `GET /api/repos/environments?repo=` : les environnements des pairs dont le remote origin correspond au dépôt ; sélecteur « S'exécute sur » sur la carte
- Diff et fin de session d'une carte distante lus via le pair ; état de son pane lu à l'ouverture de la carte (`/api/cards/:id/remote`)
- `/api/node/environments` expose l'URL normalisée du remote origin de chaque environnement (jamais le chemin)
