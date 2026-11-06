bump: minor

### Added
- Onglet « Documents » du projet : la doc Markdown de main classée par rubrique de la convention, rendue, avec recherche titre + texte
- « Décisions » : ADR (statut et date lus dans le fichier) fusionnés avec les décisions de la roadmap, plus récentes d'abord
- Routes `GET /api/docs`, `/api/docs/file`, `/api/docs/search` : lecture de l'arbre git de main (ls-tree / cat-file / grep), sans checkout
