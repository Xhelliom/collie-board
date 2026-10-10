bump: minor

### Fixed
- Le board ne merge plus une PR dont un check GitHub est rouge ; en cours, il attend le tick suivant (ADR 0029)

### Changed
- Un check rouge renvoie le worker avec le nom du check et la fin de son log (compte dans MAX_ROUNDS)
