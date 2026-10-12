bump: patch

### Fixed
- Atterrissage d'une PR : mergeabilité `UNKNOWN` et rollup vide sur une PR de moins de 5 min sont une attente relue au tick suivant, plus un abandon (ADR 0036)
- Lot : une carte n'est classée que si sa PR est mergée ou son auto-merge armé ; un conflit va à l'agent, un autre refus arrête la carte
- « PR et terminé » : le suivi relit l'état de la PR avant de s'arrêter, une PR mergée à la main classe la carte
- Une PR mergée repointe les cartes dépendantes vers la base de la prédécesseure

### Changed
- Suppression du délai de 5 s avant re-vérification et de la lecture des workflows du dépôt
