bump: minor

### Added
- Carte : « Détacher l'agent » dans « ⋯ » — termine la session ici et sur le pair, terminal laissé ouvert ; refusé à un pane d'agent.
- Pair : `/api/node/detach` oublie un pane lancé pour un pair sans le fermer ; un relancement reprend la conversation Claude du checkout (`--resume`).

### Fixed
- Carte sur un pair : un pane qui ne porte plus son agent dans le checkout de la carte n'est plus pris pour sa session — Démarrer relance dans la même branche.
- Remettre une carte distante au backlog (ou hors des colonnes actives) libère aussi sa session sur le pair.
