bump: minor

### Added
- « Ajouter un projet » : chercher un dépôt connu ou saisir un chemin absolu l'ajoute aux listes de projets (persisté, `repo_pref.listed`, route `/api/repos/listed`)
- « Retirer de la liste » sur un dépôt ajouté à la main, sans toucher à ses cartes

### Changed
- Les sélecteurs de projet (onglets, barre latérale, tableau de bord) ne montrent plus que les dépôts avec cartes et ceux ajoutés à la main, plus tous les dépôts connus
