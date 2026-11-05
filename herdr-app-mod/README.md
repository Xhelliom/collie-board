# herdr-app-mod — panneau Collie (prototype)

Mod herdr-app en lecture seule : projets du board, phase en cours, lots, « N à tester » de la
recette, et l'orchestrateur du projet (état, 3 derniers messages, dernières alertes).

```sh
ln -s "$PWD/herdr-app-mod" ~/.config/herdr-app/mods/collie
herdr-app check ~/.config/herdr-app/mods/collie
herdr-app do pane.split '{"direction":"right","mod":"collie"}'   # l'afficher
```

- Données : uniquement des `GET` sur `http://127.0.0.1:8788` (`/api/repos`, `/api/phases`, `/api/runs`,
  `/api/recette`, `/api/orchestrator`, `/api/pane/<id>/history`, `/api/notifications/log`, `/api/snapshot`),
  toutes les 10 s, sautées quand le pane du mod n'est pas dans l'onglet affiché.
- `checkAccess` : une requête **sans `Origin`** passe en lecture ; seule une écriture non-GET sans
  `Origin` depuis un Host non-loopback est refusée (« origin required »). Le mod n'écrit rien.
- Bouton orchestrateur : focalise le terminal herdr-app étiqueté `collie.pane=<paneId>` s'il existe ;
  sinon ouvre la PWA (`xdg-open`). herdr (TUI) et herdr-app ont aujourd'hui des cœurs distincts, donc
  en pratique c'est la PWA.
