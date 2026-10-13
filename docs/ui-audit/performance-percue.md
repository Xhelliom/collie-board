# Audit — performance perçue : accueil, board, page projet

**Aucun code modifié.** Hypothèse de départ (« le coût vient des poids et des requêtes enchaînées,
pas du serveur ») : **confirmée par la mesure**, voir § 1.

## Méthode — chaque chiffre porte son étiquette

| Étiquette | Comment le chiffre a été obtenu |
|---|---|
| **[4G]** | Chrome headless (`google-chrome-stable --headless=new`) piloté par CDP, profil vierge, 390 × 844 mobile, **service worker déjà installé** (page chargée une fois, puis rechargée — le cas du PWA sur le téléphone), throttling *Slow 4G* de Lighthouse (150 ms RTT, 1,6 Mb/s descendant, 750 kb/s montant) **+ CPU ×4**. Médiane de 3 chargements, fenêtre de 20 s. |
| **[local]** | Même protocole, sans throttling. Médiane de 3. |
| **[froid]** | Même protocole [4G], mais sans service worker (premier passage, ou après une release). 1 chargement. |
| **[curl]** | `curl` sur `127.0.0.1:8788`, médiane de 10 appels, `Accept-Encoding: gzip`. Temps serveur seul. |
| **[calc]** | Calcul hors ligne sur les réponses réelles (`JSON.stringify` + `gzipSync` de Bun). |
| **[code]** | Lu dans le code ; pas un chiffre mesuré. |
| **[estim.]** | Estimation, dite comme telle : extrapolée de mesures [4G] au prorata des octets. |

Jalons : **premier contenu** = instant où le `BootSplash` (« Connecting to the herd… ») quitte le DOM
et laisse la route (un `MutationObserver` injecté avant chargement) ; **contenu complet** = fin de la
dernière réponse API du premier chargement (hors `/api/config` et `/api/board/usage`, voir #12), ou le
premier contenu s'il est plus tardif. Pont local en service, build déployé `0.191.0-dev+839efe03` : entre
ce build et `HEAD`, aucun fichier du chemin de données n'a changé (`git diff --stat` sur les loaders,
le routeur, `use-polling.ts`, les trois routes et `bridge/project-facts.ts`). Données : 426 cartes (361
`done`), 8 dépôts, 13 panes. Script de mesure : CDP brut (WebSocket de Bun), non versionné.

## 1. Le serveur n'est pas le coût

| Route | Temps serveur [curl] | Brut | gzip (sur le fil) |
|---|---:|---:|---:|
| `/api/snapshot` | 2 ms (max 80) | 14 Ko | 3 Ko |
| `/api/cards` | 32 ms | 833 Ko | 226 Ko |
| `/api/project/facts` (tous les dépôts) | 38 ms | 696 Ko | 86 Ko |
| `/api/project/facts?repo=collie-board` | 27 ms | 414 Ko | 53 Ko |
| `history?limit=40` (orchestrateur) | — | 48 Ko | 16 Ko |
| toutes les autres routes de ces écrans | ≤ 6 ms | ≤ 14 Ko | ≤ 5 Ko |

Les 296 ms du snapshot relevés par l'orchestrateur ne se reproduisent pas (2 ms en médiane, 80 ms au
pire). En [4G], `/api/snapshot` répond en ~200 ms, soit un RTT : c'est le réseau. `/api/cards`, lui,
prend **1,7 s** [4G] pour ses 232 Ko : c'est le poids.

## 2. Temps mesurés

| Écran | Premier contenu [4G] | Contenu complet [4G] | Premier contenu [local] | Complet [local] |
|---|---:|---:|---:|---:|
| Accueil `/` | **1 912 ms** | 2 251 ms | 168 ms | 179 ms |
| Board `/board` (sans portée de dépôt) | 1 944 ms | 1 944 ms | 212 ms | 212 ms |
| Board `/board?repo=collie-board` (1 mesure) | 2 505 ms | 2 505 ms | — | — |
| Projet `/board/project?repo=collie-board` | **2 732 ms** | 2 878 ms | 326 ms | 436 ms |
| Accueil, démarrage à **froid** | ≈ 8,2 s (6,1 s + 2,1 s, rechargement compris, #10) | — | — | — |

Sans réseau, tout tient sous 0,5 s ; sur un lien de téléphone, c'est 2 à 3 s. La différence vient
entièrement des octets et des étapes enchaînées.

## 3. Requêtes au chargement, dans l'ordre

`B` = bloque le premier rendu (loader React Router : le `HydrateFallback` reste affiché tant que **tous**
les loaders de la route ne sont pas résolus) ; `—` = lancée par un composant après le rendu.

### Accueil — `rootLoader` + `boardLoader` (route index)

| t [4G] | Requête | Bloque | Gzip | Ce que l'écran en lit [code] |
|---|---|---|---:|---|
| 0 → 0,2 s | `/api/snapshot` | B | 3 Ko | tout (agents, panes, sessions, notifications) |
| 0 → 1,8 s | `/api/cards` | B | 232 Ko | `id`, `title`, `status`, `repoPath`, `updatedAt`, phase. **Jamais** `spec`, `acceptance`, `rawInput` (62 % du brut [calc]) |
| 0 → 1,1 s | `/api/project/facts` | B | 88 Ko | **rien** : ni `home.tsx` ni `home-dashboard.tsx` ni `lib/dashboard.ts` ne lisent `facts` |
| 1,9 → 2,3 s | `/api/phases?repo=` × 8 (un par dépôt) | — | 5 Ko | `useRepoPhases` : les phases des tuiles projet |
| 1,9 → 2,1 s | `/api/board/prs`, `/api/notifications/log`, `/api/board/usage`, `/api/config` | — | 3 Ko | PR ouvertes, activité, quota, build |

Le snapshot est là à **0,2 s**, mais rien ne s'affiche avant **1,9 s** : le triage des agents —
la première chose à l'écran (décision D1 de l'[audit de l'accueil](./accueil-et-tableau-de-bord.md))
— attend des cartes dont il ne se sert pas.

### Board — `rootLoader` + `projectLoader`

Sans portée de dépôt : les mêmes trois requêtes bloquantes. Le board lit `facts[id].milestoneEvents`
(les points des tuiles), `acceptance.length`, et n'affiche que les **5 plus récentes** cartes `done`
(`DONE_SHOWN`) sur 361 livrées en entier.
**Avec une portée** (mémorisée, donc le cas courant) : `projectLoader` ajoute les 4 étapes de la page
projet ci-dessous. Or `BoardRoute` ne lit que `cards`, `facts`, `phases` et `templates` [code] :
**lots, roadmap, orchestrateur, flows, 40 tours d'historique et mémoire sont chargés pour rien**, au
chargement comme à chaque poll.

### Page projet — `rootLoader` + `projectLoader` : quatre étapes en cascade

| Étape [4G] | Requêtes | Gzip |
|---|---|---:|
| 1 · 0 → 1,77 s | `snapshot`, `cards`, `project/facts` (**tous** les dépôts, sans `?repo=`) | 323 Ko |
| 2 · 1,80 → 2,04 s | `phases`, `runs`, `roadmap`, `orchestrator` (du dépôt), `templates`, `flows` | 13 Ko |
| 3 · 2,04 → 2,27 s | `history?limit=40` du pane orchestrateur | 16 Ko |
| 4 · 2,28 → 2,44 s | `orchestrator/memory` | 1 Ko |
| rendu 2,73 s, puis | `/api/repos`, `/api/config` (composants) | 1 Ko |

L'étape 2 n'a besoin que du `repo` de l'URL, connu dès le départ ; l'étape 4 ne dépend que de
l'orchestrateur, pas de l'historique. La cascade coûte **≈ 0,67 s** (1,77 → 2,44 s) pour 30 Ko.

## 4. À chaque poll (1,5 s dès qu'un agent travaille)

`revalidate()` relance **tous** les loaders actifs (`use-polling.ts`) ; le tick suivant n'est armé
qu'une fois la revalidation finie.

| Écran | Requêtes par tick | Octets sur le fil [4G], 12 s | Part d'un lien à 1,6 Mb/s | CPU main thread [4G, CPU ×4], 12 s |
|---|---|---:|---:|---:|
| Accueil | 3 : snapshot (3 Ko), cards (304), facts (**88 Ko**) | 640 Ko (≈ 53 Ko/s) | ≈ 26 % | 0,86 s (7 %) |
| Board sans portée | idem | 640 Ko | ≈ 26 % | 0,80 s |
| Projet / board avec portée | **11 en 3 étapes**, ≈ 2,8 s par revalidation | 1 068 Ko (≈ 89 Ko/s) | ≈ 43 % | 1,73 s (14 %) |

- `cards` revient en **304** (ETag, `conditionalGet`) tant qu'aucune carte ne bouge, mais retélécharge
  ses **232 Ko** dès qu'une seule change (vu 1 fois sur 12 s : une carte avait changé).
- `facts`, `phases`, `runs`, `roadmap`, `templates`, `flows`, `history`, `memory` passent par
  `apiRequest` : **ni ETag ni 304**, corps complet à chaque tick [code + 4G].
- Sur la page projet, le lien est occupé presque en continu : un tap (déplacer une carte, valider) part
  dans une file déjà chargée.
- Rendu [code] : aucun `memo` sur `CardTile`, `ProjectStep` ni les listes d'agents ; `facts` est un
  nouvel objet à chaque tick (`Object.fromEntries` dans `boardLoader`), donc chaque tuile et chaque
  étape se re-rend même quand rien n'a changé. Les `useMemo` de `project.tsx` dépendent de
  `data.phases`/`data.lots`, de nouveaux tableaux à chaque tick : `projectOf()` est recalculé à chaque
  poll. Le CPU mesuré (7 à 14 % du thread principal) est **imputé, non prouvé** : la mesure CDP ne
  distingue pas le `JSON.parse` de 700 Ko du rendu React.

## Constats

| # | Prio | Effort | Constat (mesuré) | Correction proposée |
|---|---|---|---|---|
| 1 | P1 | S | L'accueil charge `/api/project/facts` (88 Ko gzip, 713 Ko à parser) au démarrage **et à chaque poll**, sans jamais le lire. Il partage le lien avec `cards` pendant le chargement et pèse ≈ 3,5 Mo/min en poll [4G]. | **Alléger** : un loader d'accueil sans `facts` (garder `boardLoader` avec `facts` pour le board). |
| 2 | P1 | S | Le board avec portée passe par `projectLoader` : 7 requêtes et 3 étapes inutiles (lots, roadmap, orchestrateur, flows, historique, mémoire) au chargement et à chaque tick ; premier contenu 2,5 s au lieu de 1,9 s [4G]. | **Alléger** : un loader de board = `cards` + `facts` + `phases` + `templates`. |
| 3 | P1 | M | Le premier rendu de l'accueil attend `/api/cards` (1,7 s [4G]) alors que le triage des agents n'a besoin que du snapshot, prêt à 0,2 s. | **Charger en différé** : le loader index renvoie la promesse des cartes sans l'attendre (`<Await>`/`Suspense`) ; **squelette** pour les KPI et les projets seulement, car les cartes ne peuvent pas arriver aussi vite que le snapshot même allégées (#4). Premier contenu ≈ 0,3-0,4 s [estim.]. |
| 4 | P1 | M | `/api/cards` livre `spec`, `acceptance` et `rawInput` complets de 426 cartes, dont 361 `done` : 62 % des octets, lus par **aucun** des trois écrans en liste (la page projet n'affiche la spec complète que sur une étape dépliée). | **Alléger** : liste résumée (`specLine`, nombre de critères) et le détail via `/api/cards/:id`, qui a déjà son ETag. 226 → 93 Ko gzip [calc], soit ≈ 1,7 → 0,7 s [estim.]. Sans les `done` : 19 Ko [calc] (question Q3). |
| 5 | P1 | S | `projectLoader` enchaîne 4 étapes (cartes → dépôt → historique → mémoire), ≈ 0,67 s de cascade pour 30 Ko [4G]. | **Charger en parallèle** : les requêtes du dépôt partent avec `boardLoader` (le `repo` est dans l'URL) ; la mémoire part avec l'historique. |
| 6 | P2 | S | La page projet charge les `facts` de **tous** les dépôts (88 Ko gzip) au lieu de `?repo=` (54 Ko), et sans ETag, donc à chaque tick. Les `milestoneEvents` font 80 % de `facts` (4 420 événements bruts pour dessiner des points). | **Alléger** : `?repo=` sur la page projet ; ETag + `conditionalGet` comme `cards` ; à terme, les points calculés côté pont (31 Ko gzip sans les événements [calc]). |
| 7 | P2 | M | En poll, la page projet relance 11 requêtes en 3 étapes (≈ 2,8 s par revalidation [4G], ≈ 43 % du lien) ; `templates`, `flows`, `roadmap` et la mémoire ne changent qu'au fil d'une action. | **Alléger le poll** : `shouldRevalidate` / données hors loader pour ce qui ne bouge pas au fil de l'eau (périmètre : Q4). |
| 8 | P2 | S | Chaque poll re-rend toutes les tuiles et étapes et recalcule `projectOf()` (pas de `memo`, `facts`/`phases`/`lots` réidentifiés à chaque tick) ; 7-14 % du CPU [4G, CPU ×4]. | **Mémoïser** : `memo` sur `CardTile`/`ProjectStep` ; références stables via 304 (après #6). Mesurer à nouveau : l'imputation au rendu n'est pas prouvée. |
| 9 | P2 | S | Les assets statiques sont servis **sans compression** : JS 963 Ko (268 Ko en gzip [calc]), CSS 89 Ko (15 Ko). À froid ou après chaque release (le SW reprécharge), 5,5 s [froid] rien que pour le JS. | **Alléger** : gzip des assets (précompressés au build, ou dans `serveStatic`). Brique générique, candidate à `UPSTREAM_PRS.md` (Q5). |
| 10 | P3 | S | Au premier passage, la page se **recharge** une fois (vu en [local] et [froid]) : les requêtes API lancées à 5,7 s sont abandonnées à 6,1 s puis relancées [froid]. **Le code dit l'inverse** : `lib/pwa.ts` affirme ignorer le premier `controllerchange`. | Trouver la cause avant de corriger ; la doc et le code ne concordent pas. |
| 11 | P3 | S | `useRepoPhases` lance une requête `/api/phases` **par dépôt** (8) au montage de l'accueil. Non bloquant (≈ 0,3 s après le rendu [4G]), une seule fois. | **Alléger** : une requête pour tous les dépôts, ou les phases dans le résumé des cartes (#4). |
| 12 | P3 | S | `/api/board/usage` met 5 s en cas d'échec de cache (TTL 15 min, `bridge/usage.ts`) ; 1 ms sinon [curl]. Non bloquant : le quota apparaît en retard. | Rien, ou un **squelette** pour l'anneau : c'est la seule donnée qui ne peut pas arriver plus vite. |

Pas de constat sur `/api/snapshot` (3 Ko gzip par tick, sans ETag : négligeable).

## Ordre de correction recommandé

1. **#1 et #2** (S, aucun choix à faire) : ≈ 88 Ko par tick en moins sur l'accueil, 7 requêtes par
   tick en moins sur le board.
2. **#5** (S) : la page projet gagne ≈ 0,6 s sans rien changer à l'API.
3. **#3**, puis **#4** une fois Q1-Q3 tranchées : le premier contenu de l'accueil passe de 1,9 s à
   ≈ 0,3 s [estim.], et chaque mouvement de carte coûte 93 Ko au lieu de 232.
4. **#6, #7** : la page projet cesse d'occuper le lien en continu.
5. **#9** (froid et releases), puis **#8** (re-mesurer le CPU après #6), **#11**, **#10**, **#12**.

## Questions pour le propriétaire

- **Q1** — Accueil : accepter que le triage s'affiche **avant** les KPI et les projets, ceux-ci sous un
  squelette pendant ≈ 0,5 s (#3) ?
- **Q2** — `/api/cards` est une route publique de l'API (le skill la documente, et les consommateurs
  externes la lisent, [ADR 0013](../../.adr/0013-the-bridge-does-not-know-its-consumers.md)) : la
  **réduire** est un changement d'API (`bump: major`) ; l'alternative est un résumé à côté (`?view=summary`
  ou une route nouvelle). Lequel ?
- **Q3** — Les cartes `done` : les sortir de la liste (pagination, ou seulement les N plus récentes), en
  gardant côté pont les compteurs dont l'accueil a besoin (livrées sur 7 jours, avancement par dépôt) ?
- **Q4** — Page projet : qu'est-ce qui doit vraiment suivre le poll de 1,5 s ? Proposition : cartes,
  facts, lots, orchestrateur et sa conversation ; pas la roadmap, les templates, les flows ni la mémoire.
- **Q5** — Compression des assets (#9) : dans `serveStatic` (`server.ts`, fichier upstream, donc coût de
  rebase) ou en précompressant au build ?

## Docs et code en désaccord (signalé, non corrigé)

- `web/src/lib/pwa.ts` dit ignorer le premier `controllerchange` ; la mesure montre un rechargement au
  premier passage (#10).
- [`accueil-et-tableau-de-bord.md`](./accueil-et-tableau-de-bord.md) dit « pas de poll en plus » :
  vrai pour les KPI, mais l'accueil poll `facts` sans les lire (#1).
