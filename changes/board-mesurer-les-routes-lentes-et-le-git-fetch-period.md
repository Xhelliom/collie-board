bump: patch

### Fixed
- Documents, page Projet et onglets de pages ne lancent plus ≈ 80 `git` par appel (≈ 300 ms de boucle bloquée) : la branche par défaut n'est résolue que pour « Nouvelle carte » (`/api/repos?branches=1`)
