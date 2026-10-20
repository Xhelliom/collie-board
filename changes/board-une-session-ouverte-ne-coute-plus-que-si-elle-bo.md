bump: patch

### Changed
- Historique d'un pane : 304 par ETag quand le transcript n'a pas bougé, sans relire ni reparser le fichier
- Poll rapide (1,5 s) seulement si le pane ouvert travaille ou bloque, ou sur la page projet d'un lot en cours ; 4 s sinon
