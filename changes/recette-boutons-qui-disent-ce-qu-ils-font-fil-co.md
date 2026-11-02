bump: patch

### Changed
- Recette : boutons de verdict étiquetés (« Ça marche », « Ça ne marche pas », « Passer ») avec info-bulle qui dit leur effet
- Recette : aide « Comment ça marche » repliable, liste pleine largeur, étapes et captures côte à côte sur grand écran
- Recette : bord coloré par état, pastilles d'état par groupe, survol et focus visibles partout
- Recette : fil conducteur par entrée (projet › phase › lot › carte · PR · livré il y a…) et regroupement « Par livraison »
- `/api/recette` : chaque entrée porte `prUrl`, `runId`, `phaseId` et `project` (vue tous dépôts)

### Fixed
- Recette : le filtre « Depuis ma dernière visite » disparaît — revenir sur la page ne masque plus rien
