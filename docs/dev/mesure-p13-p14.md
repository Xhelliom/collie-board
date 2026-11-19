# Mesure P13 et P14 — 17 novembre 2026

Suite de l'[audit perf de novembre](./audit-perf-2026-11.md) (§5, P13 et P14), après P1-P4.

## Méthode

- **[banc]** : les handlers réels (`handlePageTabsRoute`, `handleRecetteRoute`, `listRepos`) sur une
  copie `.backup` de `board.db` (1 392 cartes, 40 835 événements), dans un processus Bun seul. Une sonde
  `setInterval(1 ms)` mesure pendant chaque appel le **plus long blocage** de la boucle et le **blocage
  cumulé** (somme des écarts > 3 ms) : c'est la part synchrone, celle qui fait attendre toutes les autres
  requêtes. Médianes de 9.
- **[live]** : `GET /api/diag/routes`, `/proc/<pid>/task/<pid>/stat` du bridge, `bash time` sur
  `git fetch --dry-run`, requêtes SQL en lecture seule.
- Machine **très chargée** pendant la mesure (load average 30-35, lots en cours) : les durées murales
  sont gonflées d'environ ×2 par rapport à l'audit ; les comparaisons avant/après sont faites dans les
  mêmes conditions, à quelques minutes d'écart.

## P13 — routes lentes à la navigation

**La boucle n'était pas libérée.** La cause : `listRepos()` résolvait la branche par défaut de chacun
des **65 dépôts** trouvés sous `~/git`, soit **81 `git` lancés par appel**. Chaque `Bun.spawn` coûte
≈ 4 ms **synchrones** sur la boucle (copie de l'env, fork/exec) : **≈ 300 ms de boucle bloquée** par
appel [banc]. Or trois appelants sur quatre (`/api/docs*`, `/api/docs/page-tabs`, la liste des dépôts
connus des pairs) n'utilisent que les chemins, et côté client seule la feuille « Nouvelle carte » lit
`defaultBranch` ; la page Projet appelait `/api/repos?all=1` à chaque visite pour les seuls chemins.

| [banc] | mur avant | mur après | plus long blocage avant → après | blocage cumulé avant → après |
|---|---|---|---|---|
| `listRepos` (`/api/repos`, `/api/docs*`) | 494 ms | 44 ms | 329 → 27 ms | 478 → 27 ms |
| `GET /api/docs/page-tabs` | 691 ms | 113 ms | 294 → 29 ms | 660 → 57 ms |
| `GET /api/recette?repo=` | 341 ms | 148 ms | 204 → 75 ms | 308 → 86 ms |
| `GET /api/recette` (tous dépôts) | 701 ms | 281 ms | 415 → 140 ms | 613 → 159 ms |

(La recette ne lance aucun `git` ; son « avant » plus lent reflète la charge du moment, pas le
correctif.)

**Corrigé** (petit et net) : la résolution sort de `listRepos` dans `withDefaultBranches()`, appelée
seulement par `GET /api/repos?branches=1`, que seule la feuille « Nouvelle carte » demande. Les autres
lecteurs ne lancent plus ces ≈ 80 `git`.

**Ce qui reste** :

- `/api/repos?branches=1` (ouverture de « Nouvelle carte ») bloque toujours ≈ 300 ms. → **carte
  proposée** : « Branche par défaut sans sous-processus » — lire `refs/remotes/origin/HEAD` et
  `refs/heads/{main,master}` sur disque (fichier ou `packed-refs`) au lieu de 1 à 3 `git` par dépôt ;
  `bump: patch`.
  **Fait le 19/11** : `declaredDefaultBranchOf` lit ces refs sur disque (dépôt ou worktree lié, backend
  `files` seulement ; sinon `git` comme avant). [banc] `withDefaultBranches` sur les 65 dépôts de `~/git`,
  médianes de 9, load ≈ 8-9 (moins chargée que le 17/11) : mur 96 → 16 ms, plus long blocage
  86 → 10 ms, blocage cumulé 90 → 10 ms ; branches renvoyées identiques pour les 65. Le reste : les
  dépôts sans `origin/HEAD` ni `main`/`master` demandent encore leur branche courante à `git`.
- `recette` : ≈ 75 ms de blocage sur un dépôt (lecture de toutes les cartes, ≈ 30 ms, puis
  `listEvents` par carte livrée, 188 cartes, ≈ 35 ms) ; ≈ 140 ms tous dépôts, dont ≈ 54 ms de `lotOf`
  recalculé pour chaque carte d'un même lot (64 appels, 261 lectures d'événements de membres).
  **Rien à faire maintenant** : sous 100 ms sur l'écran courant ; à reprendre (un `Map` par `runId`,
  puis une requête groupée) si l'écran « tous dépôts » devient courant.

## P14 — `copilot.review_failed` et `git fetch` du journal

**`copilot.review_failed` : rien à faire.** 5 055 des 5 092 lignes datent du **14/11 entre 14 h 18 et
15 h 26** (une rafale, jusqu'à 1 164 par tranche de 10 min, 815 pour une seule session). Elle s'arrête
avec le déploiement de #423 (« réessais espacés », une entrée par série) ; **0 ligne depuis**. Poids :
≈ 460 Ko sur 38 Mo. Le seul lecteur (`run.ts`) filtre les événements d'une carte déjà chargés. Une
purge n'apporterait rien de mesurable.

**`git fetch` du journal : rien à faire.** `journal-sync` fait au plus un fetch par dépôt partagé et
par minute (`FETCH_EVERY_MS`), 5 dépôts actifs. Coût d'un fetch [live, `time`, git + gh compris] :

| dépôt | mur | CPU (user + sys) |
|---|---|---|
| collie-board | 0,54-0,60 s | 0,09-0,10 s |
| CrewDesign, grive, sw-to-crew, kenobu-plateforme | 1,03-1,22 s | 0,23-0,28 s |
| `gh auth git-credential` seul | 0,24 s | 0,12 s |

Soit **≈ 1,1 s de CPU par minute pour les 5 dépôts, ≈ 2 % d'un cœur**. Les « ≈ 300 % CPU » de `gh`
vus dans l'audit sont un instantané `ps` d'un processus qui vit ≈ 0,2 s, pas une charge soutenue.
Côté boucle du bridge : 4 à 5 `git` par dépôt et par minute à ≈ 4 ms synchrones, ≈ 0,1 s/min. Le
fetch lui-même est asynchrone (sous-processus).

## Cartes proposées (non créées)

1. **Branche par défaut sans sous-processus** (reste de P13) — lire les refs sur disque dans
   `defaultBranchOf`, test sur un dépôt temporaire ; supprime les ≈ 300 ms de « Nouvelle carte ».
