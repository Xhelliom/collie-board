bump: minor

### Added
- Barre latérale : section « En cours » (agents qui travaillent ou t'attendent), sans rien épingler
- Épingler un projet (depuis sa page) et une carte (depuis sa fiche), à côté des agents ; puce projet / carte / agent
- `/api/board/pins` accepte `repoPath` et `cardId` à côté de `session`
- Sections « Épinglés » et « En cours » repliables, état retenu par appareil

### Changed
- Navigation : Accueil, Projets, Agents, Réglages — plus d'entrée « Board » séparée, « Spaces » devient « Agents », visible sous hc aussi
- Sous les entrées, plus de listes automatiques (projets, orchestrateurs, spaces) ni de version ; titres en casse normale, une ligne par élément
- Téléphone : épinglés en tête de la page Projets, « En cours » en tête de la page Agents
