bump: patch

### Changed
- Carte (#3, décision Q3) : « Reformuler » est retiré de l'en-tête (reste dans « Retravailler »), « Éditer » en icône seule et fil d'Ariane réduit à « Board » sous `sm` ; alerte doublon et « copilote occupé » avant les sous-tâches.
- Journal : toute ligne longue se replie (« Voir plus »), les allers-retours working ↔ review consécutifs sont regroupés, « 30 sur N — tout voir », dates relatives dans la langue de l'interface.
- Éditeur : champs à 16 px sur mobile, « Enregistrer » collant en bas de la feuille, filtre dans les sélecteurs « Fait partie de » / « Après ».

### Fixed
- Journal : `card.reopened`, `card.cleaned_up`, `card.pr_opened`, `wrapup.requested`, `wrapup.collected` s'affichent en phrases ; détail de « Restaurer » sans indentation sous `sm`.
- Diff : une erreur autre que 409 s'affiche au lieu de masquer la section.
- PR : la date de « ouverte / fusionnée / fermée » suit la langue de l'interface ; `ago` en `short` (« il y a 3 j » au lieu de « -3 j »), partout.
