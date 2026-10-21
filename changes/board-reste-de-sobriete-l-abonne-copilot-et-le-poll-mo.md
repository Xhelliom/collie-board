bump: patch

### Changed
- Copilot : les cartes à relire sortent d'une seule requête SQL au lieu de trois par carte terminée, à chaque poll (8,4 ms → 1,1 ms sur la vraie base).
- Garde de review : ne lit plus que la colonne `review`, pas tout le board, à chaque poll.
