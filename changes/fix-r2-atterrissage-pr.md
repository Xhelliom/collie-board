bump: patch

### Fixed
- Atterrissage d'une PR : mergeabilité `UNKNOWN` et rollup vide sur une PR de moins de 5 min sont une attente relue au tick suivant, plus un abandon (ADR 0036)
- Lot : une carte n'est classée que si sa PR est mergée ou son auto-merge armé ; un conflit va à l'agent, un autre refus arrête la carte
- « PR et terminé » : le suivi relit l'état de la PR avant de s'arrêter, une PR mergée à la main classe la carte
- Une PR mergée repointe les cartes dépendantes vers la base de la prédécesseure
- GitHub illisible (réseau, gh, limite de débit) : une attente, l'arrêt seulement après 5 essais de suite
- Rollup vide : la grâce de 5 min part du dernier push (`pr_updated`), plus seulement de la création de la PR
- Lot : une dépendante d'une carte classée sur auto-merge armé attend que la fusion soit vue avant de démarrer
- PR fermée puis rouverte et mergée sur GitHub : journalisée mergée, l'étape d'atterrissage ne tourne plus en rond
- Repointage d'une dépendante déjà démarrée : `card.base_moved` lui demande de merger la nouvelle base
- Suivi arrêté et dépendante en attente : GitHub relu de moins en moins souvent, au plus toutes les 30 min

### Changed
- Suppression du délai de 5 s avant re-vérification et de la lecture des workflows du dépôt
