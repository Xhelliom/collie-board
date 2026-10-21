bump: minor

### Added
- Livrables par carte : un agent publie un fichier (`POST /api/cards/<id>/deliverables?name=…`), le bridge le garde dans son state dir, liste, sert et supprime — survit au merge et au ménage du worktree (ADR 0045)
