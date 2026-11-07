# herdr-app-mod — panneau Collie (prototype)

Mod herdr-app : projets du board, phase en cours, lots, « N à tester » de la recette, l'orchestrateur
du projet (état, 3 derniers messages, dernières alertes) et les agents des cartes de ses lots.

```sh
ln -s "$PWD/herdr-app-mod" ~/.config/herdr-app/mods/collie
herdr-app check ~/.config/herdr-app/mods/collie
herdr-app do pane.split '{"direction":"right","mod":"collie"}'   # l'afficher
```

- Lecture : des `GET` sur `http://127.0.0.1:8788` (`/api/repos`, `/api/phases`, `/api/runs`,
  `/api/recette`, `/api/orchestrator`, `/api/pane/<id>/history`, `/api/notifications/log`, `/api/snapshot`),
  toutes les 10 s, sautées quand le pane du mod n'est pas dans l'onglet affiché.
- Écriture : une seule, une route existante — **« Lancer le lot suivant »** = `POST /api/runs/<id>/launch`
  sur le premier lot planifié de la phase ouverte la plus en avant (deux clics : armer, confirmer).
  Sans `x-collie-pane` : c'est le geste de l'opérateur, refusé par le bridge pour les mêmes raisons
  que depuis la PWA (lot d'un autre poste, cartes déjà finies, déjà lancé) ; sa raison s'affiche.
- `checkAccess` / CSP inchangés : une requête **sans `Origin`** vers un Host loopback passe ; une
  écriture sans `Origin` depuis un Host non-loopback reste refusée (« origin required »).
- **Ouvrir le vrai terminal.** Sous hc, herdr-app et le bridge partagent le même core : le `paneId`
  du board est l'adresse du terminal. Le bouton de l'orchestrateur et chaque agent de carte font
  `agent.focus` sur le terminal dont l'adresse est ce `paneId`, ou étiqueté `collie.pane=<paneId>` /
  `collie.card=<id>`. Sinon (herdr 0.9, cœurs distincts) : la PWA, via `xdg-open`.
- **« Ouvrir la recette ↗ »** ouvre `/board/recette?repo=<dépôt>` dans la PWA.
- Agents de carte : ceux des cartes d'un lot du dépôt (une carte hors lot n'y figure pas).
