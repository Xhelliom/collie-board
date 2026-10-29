bump: minor

### Added
- Recette : une carte porte ses tests manuels (`manualChecks`, `capability`, `usageGroup`), écrits par PATCH
- Verdict OK/KO/passé par étape, geste de l'opérateur refusé à un agent ; un KO noté peut ouvrir une carte de suite liée
- `GET /api/recette` : les cartes livrées à tester, par usage, filtrable par date
- Le worker écrit sa recette en fin de carte quand elle a un effet visible
