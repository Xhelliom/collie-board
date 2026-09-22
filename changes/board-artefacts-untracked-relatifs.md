bump: patch

### Fixed
- Artefacts de session : les fichiers d'un dossier non commité du worktree apparaissent enfin — `git status` réduit un dossier untracked à une entrée `?? docs/…/`, que la liste ignorait ; l'entrée est désormais élargie à ses fichiers servables (borné, toujours confiné).
- Artefacts de session : une mention de chemin RELATIF mono-token à extension servable (`write {path: "docs/hero-recette/page.html"}`) devient un candidat, jointe à la racine du worktree — seuls les chemins absolus étaient reconnus.