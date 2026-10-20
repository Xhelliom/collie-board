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

## 5. Re-mesure du CPU du poll (#8), après #1-#7

2026-10-19, build déployé `0.210.0+5461cf82` (même chemin de données que `HEAD`), 3 agents `working`,
donc poll à 1,5 s. Protocole [4G] (CPU ×4), fenêtre de 12 s après 10 s de stabilisation. Deux jeux :

- **[4G]** : le build déployé tel quel (`Performance.getMetrics`, deltas sur la fenêtre).
- **[profil]** : **le même code compilé sans minification**, servi par interception CDP
  (`Fetch.fulfillRequest`, SW contourné), et un `Profiler` V8 échantillonné à 200 µs : les noms des
  composants restent lisibles. Le temps d'un composant est celui de son propre corps, pas de ses
  enfants (React les appelle depuis sa boucle de travail).

Sur le fil maintenant : `cards` et `facts` reviennent en **304** (corps mis en cache, **même
référence** rendue par `conditionalGet`) ; seuls `snapshot`, `phases`, `templates` (board),
`orchestrator`, `runs` et `history` (projet) reviennent en 200.

| Écran | Tâches [4G] | dont script | Phase de rendu React [profil] | `CardTile` / `StepItem` [profil] | `projectOf` [profil] |
|---|---:|---:|---:|---:|---:|
| Accueil | 1,9 s | 0,56 s | 0,41 s (3 %) | — | 21 ms |
| Board avec portée | 1,5 s | 0,71 s | 0,40 s (3 %) | `CardTile` **9 ms** | — |
| Page projet | 3,2 s | 1,94 s | 1,1-1,4 s (9-12 %) | `StepItem` **34-46 ms** | 16-24 ms |

- **Un `memo` sur `CardTile`/`StepItem` ne gagnerait rien** : leurs corps pèsent 9 et ≈ 40 ms sur 12 s
  (moins de 0,4 % du thread). `projectOf()` : ≈ 20 ms. Non fait.
- **`JSON.parse`** : n'est plus un sujet, les deux gros corps reviennent en 304 ; `Response.json` ≈ 4 ms. Une
  carte qui bouge retélécharge `/api/cards` (318 Ko, vu une fois en 12 s) : rare.
- **Ce qui dominait le rendu de la page projet** : `clockTime` + `dayKey` de `transcript-view.tsx`,
  **≈ 350-470 ms sur 12 s** (≈ 4 % du thread). Le panneau orchestrateur re-rend ses 40 tours à
  chaque poll (`history` en 200), et `toLocaleTimeString`/`toLocaleDateString` construisent un
  formateur Intl à chaque appel. **Corrigé** : deux `Intl.DateTimeFormat` au niveau du module. Après
  correction [profil, 2 passes contre 2] : phase de rendu 1,14-1,41 s → **0,79-0,83 s**, script
  1,56-1,93 s → 1,22-1,34 s ; les deux fonctions sortent du profil.
- Le reste du temps des tâches est surtout du `(program)` natif (style, peinture, réseau) ; sur
  l'accueil il varie de 1,9 à 3,9 s d'une passe à l'autre, et n'est attribuable à aucun composant.
  Pas étudié ici.

Script de mesure : CDP brut (WebSocket de Bun), non versionné, comme au § 1.

## 6. Navigation in-app : du tap à l'écran utile (#13)

2026-10-20, `HEAD` de `main` (`0.216.0`) contre la branche, chaque build servi par interception CDP
sur le pont en service (SW contourné), données réelles. Protocole [4G] + CPU ×4, appliqués **après**
le chargement de l'accueil : on mesure la navigation, pas le démarrage. **Tap** = `pointerdown`, puis
`click` 100 ms plus tard (l'écart d'un vrai doigt), chrono depuis le `pointerdown`, donc **les 100 ms
du doigt sont comptées** ; le retour est un `history.back()` (pas de doigt). **Écran utile** = URL
cible atteinte (pour un retour : les phases de la page projet dans le DOM), puis deux frames peintes.
Parcours accueil → projet `collie-board` → carte → retour → pane de l'orchestrateur, répété 3 fois :
la 1ʳᵉ passe est une première visite, les deux suivantes des revisites (médiane). « Avant » : une
série ; « après » : deux séries, d'où deux premières visites (fourchette) et quatre revisites. Script : CDP brut,
non versionné, comme aux §§ 1 et 5.

| Transition | Avant, 1ʳᵉ visite | Avant, revisite | Après, 1ʳᵉ visite | Après, revisite |
|---|---:|---:|---:|---:|
| accueil → projet | 3 306 ms | 675 ms (675, 660) | 2 536-2 855 ms | **217 ms** (216, 226, 217, 200) |
| projet → carte | 369 ms | 340 ms (332, 340) | **209-214 ms** | **166 ms** (182, 162, 166, 150) |
| carte → retour projet | 577 ms | 569 ms (569, 552) | **112-125 ms** | **98 ms** (126, 98, 98, 94) |
| projet → pane | 401 ms | 337 ms (332, 337) | 329-334 ms | **156 ms** (155, 163, 156, 147) |

Ce que la mesure « avant » montrait : React Router garde l'écran précédent tant que **tous** les
loaders de la cible ne sont pas résolus, donc l'écran ne se vide jamais, mais il **gèle** : une revisite
attend les mêmes allers-retours qu'une première visite (ETag ou pas, un 304 reste un RTT), et la page
projet en enchaîne deux (orchestrateur → historique). Le retour arrière payait autant qu'une visite.

Corrigé (`web/src/lib/nav-cache.ts`) :

1. **Cache des loaders par URL, revalidation en arrière-plan.** Une **navigation** vers un écran déjà vu
   rend sa dernière donnée tout de suite ; dès qu'elle est à l'écran, **une** `revalidate()` la relit
   (vu à la mesure : `snapshot` + `pane` repartent dans la foulée). Un poll, lui, relit toujours et met
   le cache à jour. Navigation et revalidation se distinguent par `router.state.navigation.state`
   (vrai aussi pour un retour, où l'URL a déjà changé). Branché sur le loader racine (clé : la session,
   le snapshot est le même sur tous les écrans), accueil, board, projet, carte et pane. Historique,
   galerie, artefacts et PR restent hors cache : ils ne sont pas revalidés, une donnée affichée de
   mémoire n'y serait jamais rafraîchie. Les 304/ETag sont intacts : ils sont sous `fetch*`, le cache
   est au-dessus.
2. **Préchargement au toucher ou au survol** des liens vers un projet ou une carte : un écouteur
   `pointerover`/`pointerdown` délégué sur le document lance le loader de la cible ; la navigation qui
   suit rejoint ce chargement au lieu d'en lancer un second. Pas les panes : leur loader tient le
   discriminateur du chemin hors ligne (`lastPaneUrl`), qu'un préchargement fausserait.
3. **Ne jamais vider l'écran** : déjà vrai à la navigation (l'écran précédent reste) ; le seul écran
   vide restait le squelette de l'accueil au démarrage à froid, voulu (#3). Le cache ne change rien à
   ça, sinon que l'écran affiché tout de suite est le bon.

Aucune boucle de poll : la revalidation part d'un `router.subscribe` (fin de la navigation), une fois.

**Reste lent : la première visite d'un projet** (2,5-3,3 s). Elle télécharge la liste **complète** des
cartes (l'accueil n'a que le résumé, #4) ; le préchargement au toucher n'y gagne que les 100 ms du
doigt. Pistes, non faites : précharger la liste complète quand l'accueil est au repos (c'est du poids
sur le lien, à arbitrer), ou rendre la page projet depuis le résumé et compléter ensuite.

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
| 8 | P2 | S | ~~Chaque poll re-rend toutes les tuiles et étapes et recalcule `projectOf()` ; 7-14 % du CPU.~~ **Re-mesuré (§ 5)** : tuiles, étapes et `projectOf()` pèsent moins de 1 % du thread ; le coût venait du transcript de l'orchestrateur (un formateur Intl par tour et par poll, ≈ 4 %). | **Fermé** : pas de `memo` (inutile, mesure à l'appui) ; formateurs Intl partagés dans `transcript-view.tsx`. |
| 9 | P2 | S | Les assets statiques sont servis **sans compression** : JS 963 Ko (268 Ko en gzip [calc]), CSS 89 Ko (15 Ko). À froid ou après chaque release (le SW reprécharge), 5,5 s [froid] rien que pour le JS. | **Alléger** : gzip des assets (précompressés au build, ou dans `serveStatic`). Brique générique, candidate à `UPSTREAM_PRS.md` (Q5). |
| 10 | P3 | S | Au premier passage, la page se **recharge** une fois (vu en [local] et [froid]) : les requêtes API lancées à 5,7 s sont abandonnées à 6,1 s puis relancées [froid]. **Le code dit l'inverse** : `lib/pwa.ts` affirme ignorer le premier `controllerchange`. | Trouver la cause avant de corriger ; la doc et le code ne concordent pas. |
| 11 | P3 | S | `useRepoPhases` lance une requête `/api/phases` **par dépôt** (8) au montage de l'accueil. Non bloquant (≈ 0,3 s après le rendu [4G]), une seule fois. | **Alléger** : une requête pour tous les dépôts, ou les phases dans le résumé des cartes (#4). |
| 12 | P3 | S | `/api/board/usage` met 5 s en cas d'échec de cache (TTL 15 min, `bridge/usage.ts`) ; 1 ms sinon [curl]. Non bloquant : le quota apparaît en retard. | Rien, ou un **squelette** pour l'anneau : c'est la seule donnée qui ne peut pas arriver plus vite. |
| 13 | P1 | S | ~~Une revisite attend autant qu'une première visite (340-675 ms [4G]), et un retour arrière autant qu'un aller.~~ **Mesuré et corrigé (§ 6)** : revisites 98-217 ms, tap compris. | **Fait** : cache des loaders par URL + revalidation en arrière-plan, préchargement au toucher. Reste la première visite d'un projet (§ 6). |

Pas de constat sur `/api/snapshot` (3 Ko gzip par tick, sans ETag : négligeable).

## Ordre de correction recommandé

1. **#1 et #2** (S, aucun choix à faire) : ≈ 88 Ko par tick en moins sur l'accueil, 7 requêtes par
   tick en moins sur le board.
2. **#5** (S) : la page projet gagne ≈ 0,6 s sans rien changer à l'API.
3. **#3**, puis **#4** une fois Q1-Q3 tranchées : le premier contenu de l'accueil passe de 1,9 s à
   ≈ 0,3 s [estim.], et chaque mouvement de carte coûte 93 Ko au lieu de 232.
4. **#6, #7** : la page projet cesse d'occuper le lien en continu.
5. **#9** (froid et releases), puis **#8** (re-mesuré au § 5 : fermé), **#11**, **#10**, **#12**.

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
