bump: patch

### Fixed
- La review du copilote lisait un diff vide pour une carte sans base : le travail commité est maintenant comparé à la branche du checkout principal, et la base est enregistrée résolue au démarrage
- Supprimer un template le retire des flux qui l'utilisaient
