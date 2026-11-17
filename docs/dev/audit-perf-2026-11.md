# Audit de performance — bridge, web, outillage, mise à jour (novembre 2026)

**Statut :** 🟡 constats livrés — les corrections attendent la décision ouverte sur la roadmap (§ 6)

**Aucun code modifié.** Mesuré le 2026-11-17 sur la machine qui sert le board (Linux, 16 cœurs,
31 Go, charge 5 à 10 pendant les mesures : des lots tournaient), bridge `0.347.1` en service, base réelle
(1 364 cartes dont 1 158 `done`, 395 lots, 9 panes d'agent). Audit précédent :
[`docs/ui-audit/performance-percue.md`](../ui-audit/performance-percue.md) (2026-10-14, constats #1-#13,
cités « audit perf #n » dans le code) — comparaison au § 5.

## Méthode — chaque chiffre porte son étiquette

| Étiquette | Comment |
|---|---|
| **[diag]** | `GET /api/diag/routes` après 11 min de service (uptime 660 s), opérateur et agents au travail. |
| **[proc]** | `/proc/<pid>/stat` + `CPUUsageNSec` du cgroup, toutes les 10 s pendant 592 s ; `journalctl` (« Consumed … ») sur 48 h. |
| **[bench]** | `BoardDb` du dépôt sur une **copie** de `board.db` (`.backup`), médiane de 5 ; variante avec un index ajouté sur la copie seulement. |
| **[sql]** | `sqlite3` en lecture seule : `EXPLAIN QUERY PLAN`, `.timer`, `dbstat`. |
| **[curl]** | `curl` local, 5 appels. |
| **[lag]** | Sonde : `GET /api/snapshot` (≈ 2 ms de travail) toutes les 100 ms pendant 60 s ; sa latence = l'attente sur la boucle de Bun. |
| **[cdp]** | Chrome headless (CDP brut), 1 440 × 900, **sans** throttling, SW installé ; 8 s de stabilisation puis 60 s (requêtes) ou 30 s (CPU) par écran. Rendus : un faux `__REACT_DEVTOOLS_GLOBAL_HOOK__` compte les commits et les composants rendus (fibres avec `PerformedWork`). CPU : `Performance.getMetrics` (`TaskDuration`, `ScriptDuration`). |
| **[time]** | Chronométrage d'un script bash, dans ce worktree, l'une après l'autre. |
| **[code]** | Lu dans le code, pas mesuré. |
| **[estim.]** | Extrapolation d'une mesure, dite comme telle. |

Scripts de mesure (CDP, sonde, bench) : non versionnés, comme à l'audit d'octobre.

## 1. Bridge

### 1.1 Une page Projet ouverte bloque la boucle : c'est la « reconnexion » au changement de page

Sonde [lag], `/api/snapshot`, 60 s :

| Situation | p50 | p90 | p99 | max | > 500 ms |
|---|---:|---:|---:|---:|---:|
| Aucun écran ouvert | 3 ms | 4 ms | 25 ms | 493 ms | 0 |
| **Une** page Projet ouverte (desktop) | 3 ms | **209 ms** | **572 ms** | **1 393 ms** | 10 |

Bun sert tout sur un seul thread, et `bun:sqlite` est synchrone : une route qui calcule 300 à 600 ms fait
attendre toutes les autres. [cdp] le montre aussi : `/api/board/pins` coûte 1 ms côté serveur mais est
vu à **621 ms** en médiane, parce qu'il part en même temps que `/api/project/quick` et attend derrière
lui.

Côté client [code] : `useLoadingStalled` (`web/src/hooks/use-loading-stalled.ts`) passe à `stalled` dès
qu'une navigation **ou** un poll dure plus de **2,5 s**. `isConnecting` le compte comme une perte de
connexion, et le chien galope avec le libellé « reconnexion » (`app-nav.tsx`, `collie-home.tsx`). Une
navigation enchaîne plusieurs loaders, chacun retardé de 0,2 à 1,4 s : on dépasse 2,5 s sans aucune
coupure réseau. C'est le symptôme signalé par l'opérateur le 17/11 (« une reconnexion très régulière
quand on change de page, on attend 3 secondes »). Les sept redémarrages du service en 24 h sont tous des
mises à jour (`Stopping`/`Started` propres dans `journalctl`), pas des plantages.

### 1.2 Les routes qui tiennent la boucle

[diag], 660 s, triées par temps cumulé :

| Route | Appels | Cumulé | Moyen | Max | Octets | 304 |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/project/quick` | 58 | **36,7 s** | **633 ms** | 756 ms | 11 Ko | 41 |
| `GET /api/pane/:id/history` | 235 | 32,6 s | 139 ms | **5 279 ms** | 251 Ko | 145 |
| `GET /api/runs` | 62 | **20,9 s** | **336 ms** | 620 ms | **1 594 Ko** | **0** |
| `engine poll` | 76 | 14,0 s | 184 ms | 2 760 ms | — | — |
| `GET /api/recette` | 14 | 9,3 s | 663 ms | 2 480 ms | 608 Ko | 0 |
| `GET /api/repos` | 12 | 8,5 s | 707 ms | 2 759 ms | 24 Ko | 0 |
| `engine enrichSessionNames` | 76 | 5,7 s | 75 ms | 2 699 ms | — | — |
| `GET /api/docs/page-tabs` | 13 | 5,5 s | 422 ms | 2 909 ms | 2 Ko | 0 |
| `GET /api/cards` | 77 | 4,2 s | 55 ms | 309 ms | 3 533 Ko | 66 |
| `GET /api/project/facts` | 53 | 3,9 s | 74 ms | 464 ms | 575 Ko | 49 |
| `GET /api/snapshot` | 291 | 0,7 s | 2,2 ms | 27 ms | 641 Ko | 0 |

Le moyen et le max sont la durée du handler, attentes asynchrones comprises (Herdr, git, disque, et les
reprises après d'autres tâches de la boucle). Temps vus par un client, serveur au calme [curl] :
`quick` 0,56-0,60 s · `runs` (tous les dépôts) 0,57 s · `runs?repo=collie-board` 0,25-0,27 s ·
`docs/page-tabs` 0,24-0,34 s · `repos` 0,18-0,22 s · `recette` 0,14-0,18 s · `phases` 1 ms.

**Cause de `quick` et `runs` : un index manquant.** `quickAccess()` et `lotView()` appellent
`runMembers(run.id)` pour **chacun des 395 lots** ; la requête `SELECT * FROM card WHERE run_id = ?` fait un
`SCAN card` + `TEMP B-TREE` [sql] (1-3 ms par lot). [bench] sur la copie :

| Mesure | Sans index | Avec `CREATE INDEX … ON card(run_id)` |
|---|---:|---:|
| `runMembers` × 395 lots | 342 ms | **11,5 ms** |
| `GET /api/runs` (`lotView` × 395) | 537 ms | **91 ms** |
| `GET /api/project/quick` | 566 ms | **110 ms** |

Sur ce qui reste, `runFinishedAt` × 395 coûte **73 ms** [bench] : un `json_extract(payload,'$.runId')` sur les
381 événements `run.finished` par lot, alors que la colonne `run.finished_at` existe et qu'elle est écrite au
même moment (`recordRunEvent`).

L'historique d'un pane : 1,6 à 2,8 s au premier appel pour un pane `done` [curl], puis 5 ms (le parse est
mis en cache par taille/mtime). C'est un coût de première ouverture, pas de poll.

### 1.3 Abonnés `onUpdate` et boucle de l'engine

[diag], 76 polls de l'engine en 660 s (cadence de repos, le flux d'événements est en service) : les
abonnés synchrones coûtent **≈ 90 ms par poll** à eux tous. Les plus lourds : `run` 20,6 ms (max 51), `goalWatch`
16,9 (max 84), `prFollow` 15,2, `copilot` 14,1, `stuckCards` 9,5. Total ≈ 7,8 s sur 660 s (1,2 % de la boucle).
`engine poll` (184 ms en moyenne, 2,76 s au pire) et `enrichSessionNames` (75 ms, 2,7 s au pire) attendent le
socket Herdr (`readPane`) : de l'attente asynchrone, qui ne bloque pas la boucle. Pas de constat prioritaire ici.

### 1.4 CPU et mémoire du process

- **Au repos relatif** (un client, des agents au travail) [proc] : bun lui-même **19 %** d'un cœur, cgroup
  **22 %**, RSS 183 → 486 Mo sur 592 s.
- **Pendant les lots** [proc, journal 48 h] : le cgroup du service a consommé jusqu'à **1 h 55 de CPU en
  1 h 05** (≈ 1,8 cœur en moyenne), **1 h 28 en 43 min** (≈ 2 cœurs), avec des pics mémoire de **2,5 à 5,2 Go**
  et du swap (282 Mo au pire). Ce n'est pas le bridge seul : le **gate** (`bun run check` pour ce dépôt) est
  lancé par le coordinateur (`bridge/run.ts`, `pr-follow.ts` → `bridge/gate.ts`, `Bun.spawn`), donc **dans le
  cgroup du service**, sans `nice` [code]. Un gate = typecheck × 2 + `bun test` + test ctl + Vitest, soit
  **≈ 205 s** à 4 workers jsdom (§ 3).
- La synchro du journal lance un `git fetch` par dépôt toutes les 60 s (`journal-sync.ts`,
  `FETCH_EVERY_MS`) ; chacun réveille `gh auth git-credential`, vu à 266-300 % CPU un court instant [proc]. Mineur.

### 1.5 SQLite

[sql] `board.db` **37,2 Mo** (9 516 pages de 4 Ko, 0 page libre), WAL **402 Ko** (les checkpoints passent),
`-shm` 32 Ko. Répartition (`dbstat`) : `event` 10,5 Mo (40 093 lignes) + ses deux index 4,9 Mo ;
`journal_field` 5,9 Mo + son autoindex 5,5 Mo (42 920 lignes) ; `session` 5,0 Mo (1 820) ; `card` 3,3 Mo.

`EXPLAIN QUERY PLAN` des requêtes les plus appelées :

| Requête | Plan | Temps |
|---|---|---:|
| `runMembers` (`card WHERE run_id = ?`) | **`SCAN card` + `TEMP B-TREE`** | 1-3 ms × 395 |
| `runFinishedAt` | `event_type_idx` puis `json_extract` sur 381 lignes | 0,2 ms × 395 = 73 ms [bench] |
| `listEvents(card, 200)` | `SEARCH event USING INDEX event_card_idx` | < 1 ms |
| `listCardsOwedReview` (copilot, chaque poll) | `SCAN card` + sous-requêtes indexées | 17 ms |
| `listCards` | `SCAN card` (1 364 lignes) | 16 ms [bench] |

Index manquant : **`card(run_id)`**. `card` n'a aucun index secondaire (ni `repo_path`, ni `status`, ni
`phase_id`) ; seul `run_id` coûte aujourd'hui de façon mesurable. 5 092 événements `copilot.review_failed`
(13 % de `event`) : du bruit qui grossit la table, sans effet mesuré sur les temps.

## 2. Web

### 2.1 Bundle

`vite build` [time] : **un seul chunk JS de 1 443,9 Ko (401,6 Ko gzip)**, CSS 110 Ko (18,2 Ko gzip),
précache du SW **1 856 Ko** (23 entrées). Aucun `import()` dynamique : la taille « par route » est la même
pour toutes, et Vite avertit (> 900 Ko). En octobre : 963 Ko (268 Ko gzip), soit **+50 %** en un mois. Avec
9 releases en 24 h, chaque release refait télécharger les 402 Ko gzip au téléphone (assets précompressés
depuis le #9, mais toujours entiers). Le build lui-même est rapide : 1,2 s (Rolldown), 3 s avec le SW.

### 2.2 Polling par écran

[cdp], desktop non throttlé, 60 s par écran après 8 s de stabilisation. Cadence du poll : 1,5 s dès qu'un
agent travaille, 4 s sinon, selon l'écran.

| Écran | Requêtes/min | dont 304 | Ko/min | Commits React/min | Composants rendus/min | Thread principal [cdp, 30 s] |
|---|---:|---:|---:|---:|---:|---:|
| Accueil `/` | 55-60 | 19-20 | 212-346 | 70-78 | 14 000-15 200 | 1,56 s/min (2,6 %) |
| **Projet** `collie-board` | **330** | 124-126 | **1 372-1 394** | 218-225 | **282 000-292 000** | 3,13 s/min (5,2 %) |
| **Recette** `collie-board` | 40-44 | 5-6 | 81-87 | 43-44 | **126 700-129 500** | **4,37 s/min (7,3 %)** |
| Terminal (`/pane/t49`) | 160-162 | 74-76 | 226 | 264-269 | 196 800-200 800 | 2,51 s/min (4,2 %) |

Détail des routes de la page Projet (par minute) :

| Route | /min | 304 | Ko/min | Médiane | Max |
|---|---:|---:|---:|---:|---:|
| `/api/runs?repo=` | 39 | **0** | **859** | **357 ms** | 926 ms |
| `/api/phases?repo=` | 40 | **0** | 265 | 36 ms | 668 ms |
| `/api/herd` | 40 | 0 | 108 | 12 ms | 301 ms |
| `/api/snapshot` | 40 | 0 | 100 | 9 ms | 15 ms |
| `/api/orchestrator` | 40 | 0 | 15 | 14 ms | 302 ms |
| `/api/pane/:id/history` | 40 | 40 | 5 | 344 ms | 918 ms |
| `/api/cards` · `/api/project/facts` | 40 + 40 | 80 | 16 | 33 ms | 667 ms |
| `/api/project/quick` · `/api/board/pins` | 6 + 6 | 6 | 4 | **674 ms** | 763 ms |

- `/api/runs` et `/api/phases` passent par `apiRequest` : **ni ETag ni 304**. Ils pèsent 82 % des octets de
  la page, et `runs` est la route lente du § 1.2, appelée 39 fois par minute.
- `/api/herd` (les pairs) et `/api/snapshot` partent tous les deux à chaque tick, sur **tous** les écrans,
  sans 304 : 208 Ko/min sur la page Projet et le terminal.
- Accueil : plus de `facts` au poll (#1 d'octobre tenu) ; `cards` revient en 304 (14 sur 15).

### 2.3 Rendus inutiles

- **Recette** : 15 polls/min, rien ne change dans ses données (seuls `snapshot` et `herd` partent), et
  pourtant **≈ 8 600 composants rendus à chaque poll** (129 000/min ÷ 15) pour **2,3 s de script/min**,
  soit ≈ 155 ms de script par tick, sur un desktop non throttlé. Un téléphone (CPU ×4) y passerait
  ≈ 30 % du thread [estim.]. La revalidation racine re-rend tout l'écran.
- **Projet** : ≈ 7 300 composants par tick (40 ticks/min). Le profil d'octobre (§ 5 de l'audit) avait
  innocenté `CardTile`/`StepItem` ; le coût mesuré ici (3,1 s de tâches/min) est du même ordre que les
  3,2 s d'octobre (protocoles différents : octobre en CPU ×4 sur 12 s).
- **Terminal** : 264 commits/min pour 40 ticks, soit **6,6 commits par tick** : chaque réponse
  (`snapshot`, `herd`, `pane`, `history`) arrive dans son propre commit. ≈ 750 composants par commit.
- **Accueil** : ≈ 200 composants par commit. Pas de constat.

## 3. Outillage

[time], dans ce worktree, l'un après l'autre, charge 5 → 10 :

| Étape | Durée |
|---|---:|
| `git fetch` + `check-version.sh` + `bun install` × 2 (aucun changement) | ≈ 1 s |
| `tsc --noEmit` (racine) | 6 s |
| `tsc` (web) | 16 s |
| `bun test ./bridge ./scripts` (2 271 tests, 132 fichiers) | **51 s** |
| `collie-board-ctl.test.sh` | 13 s |
| **Vitest** (2 267 tests, 216 fichiers, `maxWorkers: 4`) | **119 s** (Vitest dit 117,8 s) |
| `vite build` + SW | 3 s |

- **Le pre-push dure ≈ 205 s** (typecheck × 2 + `bun test` + ctl + Vitest), et Vitest en fait **58 %**.
  Le détail de Vitest : `environment 160,7 s`, `setup 86,1 s`, `import 52,5 s` cumulés, contre `tests 123,8 s` :
  jsdom et le fichier de setup (MSW, Testing Library), recréés pour chacun des 216 fichiers, coûtent plus
  que les tests eux-mêmes.
- **La même suite tourne trois fois par carte** : au pre-push de l'agent (dans son pane), au gate du
  coordinateur (dans le cgroup du bridge, § 1.4), puis en CI. Avec plusieurs cartes d'un lot en
  parallèle, ce sont des gates de 205 s × N à 4 workers jsdom chacun : la saturation constatée pendant les
  lots.

## 4. Mise à jour (Réglages → À propos)

Constat opérateur du 17/11 : près d'une minute sur le Dell (Windows), sans dire où elle en était.

**Les étapes** (`scripts/ctl.ts update` sous Windows, `collie-board-ctl.sh update-bash` ici, même suite) :
`git fetch`/`pull` → `check-version` → `bun install` racine + web → **typecheck racine + web** → `vite build`
(staging + swap) → arrêt/démarrage → `herdr plugin link` (checkout lié seulement).

| Étape | Ici (Linux) [time] | Le Dell (Windows) [time, 17/11] |
|---|---:|---:|
| fetch | ≈ 1 s (avec check-version + installs) | 1,8 s |
| `bun install` racine + web (lockfile inchangé) | (inclus ci-dessus) | 6,1 s |
| typecheck racine + web | **22 s** (27,6 s au re-chronométrage) | **46,4 s** (14,7 + 31,7) |
| vite build + SW | 3 s | **33,8 s** |
| redémarrage (`Stopping` → `listening`) [journal] | 1,2 s | non mesuré (`printBanner` attend jusqu'à 10 s) |
| **Total** | **≈ 27 s, dont 80 % de typecheck** | **≈ 88 s + redémarrage** |

**Dell chronométré le 17/11** (carte « Mise à jour : sans revérification, et l'étape affichée ») : étape par
étape dans le checkout installé par Herdr, depuis un terminal du pair, build dans un dossier jetable — la
version en place n'a pas bougé. `vite build` y coûte 11 fois plus qu'ici : piste suivante si 43 s restent
trop (antivirus sur `node_modules`/`dist-staging`, non vérifié).

**Après P7** (typecheck sauté sur une release, + `git ls-remote --tags` pour le savoir : 0,6 s ici comme sur
le Dell) : ≈ 5 s ici, ≈ 43 s + redémarrage sur le Dell. Somme des étapes mesurées, pas une mise à jour de
bout en bout : la première release qui porte P7 sera la première à en profiter.

- **Évitable : le typecheck.** La CI (`.github/workflows/ci.yml`) typecheck les deux côtés sur `main` avant
  que `release.yml` ne coupe la version, et une mise à jour vise une release : les 22 s refont un travail
  déjà prouvé vert. `SKIP_TYPECHECK=1` existe déjà dans les deux scripts.
- **Pas évitable** : `vite build` (3 s, `web/dist` n'est pas versionné), le redémarrage, et `bun install`
  quand le lockfile bouge.
- **L'interface attend en silence.** `ApplyUpdateControl` affiche « Mise à jour vers X en cours… » et « La
  page se recharge sur la nouvelle version à la fin », puis attend jusqu'à **180 s** (`UPDATE_WAIT_MS`) que la
  requête échoue ou que `lib/self-update.ts` voie le nouveau build (deux polls de suite). Aucune étape n'est
  remontée : le script écrit sur sa sortie, le bridge n'en relaie rien [code].

## 5. Comparaison avec l'audit d'octobre

| Octobre (#) | Novembre |
|---|---|
| #1 `facts` au poll de l'accueil | **Tenu** : plus de `facts` au poll de l'accueil [cdp]. |
| #4 `/api/cards` complet, 226 Ko gzip | **Tenu** : `?view=summary` ; le poll revient en 304 (14/15) ; 130 Ko/min quand une carte bouge. |
| #6 `facts` sans ETag | **Tenu** : 304 (49/53 [diag], 40/40 [cdp]). |
| #7 la page projet relance 11 requêtes par tick | **Partiel** : roadmap, templates et flows ne sont plus relus ; mais `runs` et `phases`, sans ETag, pèsent 1,1 Mo/min, et `runs` est devenu lent (§ 1.2). |
| #9 assets non compressés, 963 Ko | **Tenu** pour la compression ; **régressé** sur le poids : 1 444 Ko (+50 %). |
| § 1 « le serveur n'est pas le coût » (2 à 38 ms) | **N'est plus vrai** : `quick` 0,6 s, `runs` 0,3-0,6 s, et ils bloquent la boucle (§ 1.1). La base a triplé (426 → 1 364 cartes) et le nombre de lots croît sans index. |
| #13 revisite 98-217 ms | Non re-mesuré en 4G ; la navigation se heurte maintenant à la boucle bloquée (§ 1.1). |

## Constats classés

Gain : **G1** ressenti tout de suite par l'opérateur · **G2** net, mesurable · **G3** marginal.
Effort : **XS** une ligne · **S** une carte courte · **M** une carte · **L** plusieurs cartes ou une décision.

| # | Gain | Effort | Constat (mesure) | Correction proposée |
|---|---|---|---|---|
| P1 | G1 | **XS** | Index manquant `card(run_id)` : `runMembers` × 395 = 342 ms ; `/api/runs` 537 ms, `/api/project/quick` 566 ms [bench]. | `CREATE INDEX IF NOT EXISTS card_run_idx ON card(run_id)` dans `SCHEMA` : 91 et 110 ms [bench]. |
| P2 | G1 | S (suit P1) | Une page Projet ouverte fait monter le p90 d'une requête de 2 ms à 209 ms, le p99 à 572 ms, le max à 1,4 s [lag] ; une navigation passe 2,5 s et le chien affiche « reconnexion » (symptôme du 17/11). | P1 + P3 + P4, puis re-mesurer avec la même sonde. Si un écart reste, dissocier côté client « navigation lente » et « connexion perdue » (`useLoadingStalled` alimente `isConnecting`). |
| P3 | G1 | S | `/api/runs?repo=` : 39 appels/min, **0** 304, 859 Ko/min, médiane 357 ms sur la page Projet [cdp] ; `/api/phases` 265 Ko/min, 0 304. | ETag + `conditionalGet` sur `runs` et `phases`, comme `cards`/`facts` ; `runFinishedAt` lu dans `run.finished_at` (−73 ms [bench]). |
| P4 | G2 | S | `/api/project/quick` parcourt les 395 lots à chaque appel (633 ms en moyenne, 36,7 s cumulées en 11 min [diag]), toutes les 10 s par client. | Filtrer en SQL (lots lancés, non finis ou finis depuis moins de 7 jours) au lieu de tout charger ; ETag déjà là. |
| P5 | G1 | M | Le cgroup du service consomme ≈ 2 cœurs et jusqu'à 5,2 Go pendant les lots [journal] : les gates (`bun run check`, ≈ 205 s, 4 workers jsdom) tournent dans le cgroup du bridge, sans priorité réduite. | Gates en `nice`/`ionice` (ou un scope systemd à `CPUWeight` bas), au plus un gate à la fois par machine. |
| P6 | G2 | M | La même suite (≈ 205 s) tourne trois fois par carte : pre-push, gate, CI [time + code]. | À trancher (décision) : un gate qui ne relance pas ce que le pre-push a validé sur le même commit, ou un pre-push réduit (`vitest --changed`) quand le gate suit. |
| P7 | G2 | S | Mise à jour : 22 s de typecheck sur ≈ 27 s ici, déjà faits en CI [time] ; l'interface attend en silence jusqu'à 180 s [code]. | `SKIP_TYPECHECK=1` sur le chemin `update` quand la cible est une release ; et dire l'étape en cours (le script l'écrit dans un fichier d'état, À propos le lit). Chronométrer le Dell d'abord. |
| P8 | G2 | S | Recette : ≈ 8 600 composants re-rendus par poll alors que ses données ne changent pas ; 4,4 s de thread/min (7,3 %) sur desktop [cdp]. | Isoler l'écran de la revalidation racine (`memo` sur la liste, ou données de la recette hors du loader racine). Profiler avant, comme en octobre. |
| P9 | G2 | M | Bundle d'un seul chunk : 1 444 Ko / 402 Ko gzip, +50 % en un mois, re-téléchargé à chaque release (9 en 24 h) [time]. | `React.lazy` par route (Projet, Recette, Documents, PR, Réglages, Galerie) ; budget de taille vérifié au build. |
| P10 | G3 | S | Vitest : 119 s, dont 161 s d'environnement et 86 s de setup cumulés pour 124 s de tests [time]. | Essayer `happy-dom` ou `isolate: false` sur les fichiers purs ; mesurer avant d'adopter. |
| P11 | G3 | S | `/api/herd` et `/api/snapshot` à chaque tick sur tous les écrans, sans 304 : 208 Ko/min sur Projet et Terminal [cdp]. | ETag sur `herd` (les pairs bougent rarement). |
| P12 | G3 | S | Terminal : 6,6 commits React par tick, un par réponse [cdp]. | Grouper les réponses d'un tick en un seul rendu. Coût modéré (2,5 s/min) : après P8. |
| P13 | G3 | S | `docs/page-tabs` 0,24-0,34 s, `repos` 0,18-0,22 s, `recette` 0,14-0,18 s en temps propre [curl], à chaque navigation vers ces écrans. | Mesurer leur part synchrone après P1-P4 ; ne rien faire si la boucle est libérée. |
| P14 | G3 | XS | 5 092 événements `copilot.review_failed` (13 % de `event`) ; `git fetch` × 5 dépôts toutes les 60 s réveillent `gh` à ≈ 300 % CPU [sql, proc]. | Rien tant que ce n'est pas mesuré comme un coût ; à revoir si `event` gêne. |

**Ordre recommandé :** P1 (une ligne, gain immédiat) → P3 + P4 → re-mesure de P2 avec la sonde → P5 →
P7 (après chronométrage du Dell) → P8 → P9 → P6 (décision) → le reste.

## 6. Décision ouverte

Proposée sur la roadmap de `collie-board` (« Audit perf de novembre : quelles cartes de correction ? »).
Les cartes proposées, **non créées** :

1. **Index `card(run_id)` et `runs`/`phases` en GET conditionnel** (P1 + P3), `bump: patch`.
2. **Accès rapide filtré en SQL** (P4), `bump: patch`.
3. **Re-mesure de la « reconnexion » à la navigation** après 1 et 2 ; si elle reste : séparer navigation
   lente et connexion perdue côté client (P2).
4. **Gates à basse priorité, un à la fois** (P5).
5. **Mise à jour sans typecheck redondant, avec l'étape affichée** (P7), précédée d'un chronométrage sur le
   Dell.
6. **Recette hors de la revalidation racine** (P8), profil à l'appui.
7. **Découpage du bundle par route** (P9).
8. **Pre-push, gate, CI : une suite au lieu de trois** (P6), à trancher avant de coder.
