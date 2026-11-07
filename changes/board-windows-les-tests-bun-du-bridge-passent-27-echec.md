bump: patch

### Fixed
- Windows : la jauge de contexte retrouve l'heure de démarrage de l'agent (`GetProcessTimes`), donc le bon transcript
- Windows : les artefacts d'une carte écartent `node_modules`/`dist`/`.board` et gardent les fichiers cités en `C:\…`
- Windows : les docs d'un autre projet s'ouvrent quand git et herdr n'épellent pas le chemin pareil (`C:/` / `C:\`, casse)
- Le chemin par défaut de la base opencode suit la plateforme demandée, pas celle de l'hôte
- `bun test` du bridge passe sous Windows (chemins, séparateurs, PATH, faux `gh`, symlinks et droits POSIX en skip motivé)
