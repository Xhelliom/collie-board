bump: minor

### Added
- Catégorie `explore` : déclarable à la création (`POST /api/cards`), seule catégorie possible hors copilote ; jamais d'`origin`/`originCardId` déclarés
- Le prompt *check* du lead juge la conclusion et les cartes proposées d'une carte `explore`, pas le diff
