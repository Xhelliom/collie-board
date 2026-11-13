bump: minor

### Added
- Recette en chronologie des livraisons (Aujourd'hui, Hier, date) : phase, « carte : … », visuel et vignettes, étapes cochées / en cours / à faire, mention « téléphone ».
- Filtre « Tout l'historique » : les livraisons validées restent visibles, repliées en vert.
- Chaque étape : « Aller voir » (l'écran où la faire) et « Me préparer le test » (demande à l'orchestrateur du projet, `POST /api/cards/<id>/checks/<step>/prepare`).
- Session « Vérifier une à une » : une étape en grand, touches O / N / P, filtre Tout / Ordinateur / Téléphone.

### Changed
- « Pas bon » ne demande plus de cause : il crée (ou complète) une seule carte de correction dans la phase de la carte testée, rattachée à elle ; la page dit où elle va.
- Libellés « C'est bon / Pas bon / Passer », plus de « Faire / Attendu », chaque capture montrée une fois.
