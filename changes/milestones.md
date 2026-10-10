bump: minor

### Added
- Jalons : valider une phase fige ses étapes terminées, déplace les ouvertes vers une autre phase et clôt l'item de roadmap lié ; réouvrable
- « Valider les étapes terminées comme un jalon » pour un vieux projet sans phases
- Vue projet : anneau, compteurs et pourcentage lisent le jalon en cours ; « N étapes livrées dans M phases validées » et section « Phases validées »

### Changed
- Valider une phase est le geste de l'opérateur : refusé à tout header `x-collie-pane` (l'orchestrateur propose, ne valide pas)
