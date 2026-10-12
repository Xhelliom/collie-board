# Audit UI — board, détail d'une carte, PRs (mobile 390 px)

**Méthode du rendu mobile** : lecture du code (`router.tsx`, `routes/board.tsx`, `routes/card.tsx`, `routes/prs.tsx`, `card-tile`, `card-journal`, `card-diff`, `card-editor`, `board-tabs`, `app-header`, `app-nav`) et des classes Tailwind / breakpoints. Un navigateur Chrome était connecté, mais sur une autre machine (Windows) qui ne joint pas l'URL Tailscale du pont (page d'erreur, aucune capture) : **aucun rendu réel**. Les débordements ci-dessous sont déduits des largeurs et restent à confirmer à l'écran. Aucun code modifié.

Complète [l'audit des panes, spaces, galerie et réglages](./panes-spaces-galerie-reglages.md), qui laissait la page carte hors de son périmètre.

## Question
Les pages `board`, `board/prs` et `card/:cardId` (journal, diff, éditeur, tuiles) mettent-elles l'essentiel d'abord, replient-elles les textes longs, évitent-elles les doublons, et tiennent-elles à 390 px ?

## Constats (classés par priorité ; le # est l'identifiant stable)

| # | Page | Problème | Correction | Effort | Prio |
|---|------|----------|------------|--------|------|
| 1 | Carte | **Ordre mobile** : la colonne « live » (`order-2` : pane, jauge, boîte de prompt, Start, Intégration, Déplacer vers) vient **après** tout le document (`order-1` : sous-tâches, spec, critères, diff, reprise, revues, sessions, journal). Sur une carte en cours, la boîte pour parler à l'agent et le bouton d'intégration sont sous le journal. Choix assumé dans le code (« même `order` sur les deux »), d'où Q1. | Sur mobile, remonter un résumé live (pane + prompt + action principale) sous le titre ; garder l'ordre actuel à `lg`. | M | Haute |
| 2 | Carte | **En-tête trop chargé à 390 px** : retour (36) + fil « Board › titre » + « Reformuler » **et** « Éditer » avec libellé texte + « ⋯ » + cloche. Les deux boutons texte (~110 + ~80 px) ne se replient jamais en icône : le titre du fil est réduit à quelques caractères, voire à rien. | Icône seule sous `sm` (comme « + Nouvelle carte » du board), ou Reformuler dans « ⋯ » (cf. #3). | S | Haute |
| 3 | Carte | **Doublon** : « Reformuler » est dans l'en-tête **et** dans la section « Reprise », avec le même état de confirmation. | Le garder dans « Reprise » seulement (ou seulement dans l'en-tête). | S | Haute |
| 4 | Board | **En-tête qui déborde** : `rightLead` peut aligner puce dépôt (nom non tronqué) + tag + « auto » + « Sélectionner » + « Toute la phase » + « Filtrer », puis « + » et la cloche, dans un `flex gap-3` sans `overflow` ni `shrink`. Avec un dépôt sélectionné + Sélectionner + Filtrer, on dépasse déjà ~358 px utiles : le titre « Board » disparaît et la rangée peut sortir de l'écran. | Déplacer les puces de filtre actives sous l'en-tête (rangée défilante `overflow-x-auto`), ou `truncate max-w-*` sur la puce dépôt. | S | Haute |
| 5 | Carte / journal | **Texte long illisible** : hors `run.*`, chaque ligne est `truncate` (une ligne) sans moyen de l'ouvrir. Or `copilot.explained` (explication d'un échec, plusieurs paragraphes `\n\n`), `card.start_failed` (erreur), `card.automerge_refused`, `agent.notify`, la raison d'un `card.status` sont justement les textes à lire. À l'inverse, les `run.*` sont affichés en entier (`whitespace-pre-wrap`) et peuvent monopoliser la liste. | Ligne repliée à 1–2 lignes (`line-clamp-2`) + tap pour déplier, pour **tous** les types ; inclure `copilot.explained` dans le cas « wrap ». | S | Haute |
| 6 | PRs | **Statut masqué** : la page a la barre de nav mobile (`rootKeyFor` couvre `/board/*`, `fixed bottom-0 z-40`) mais place `StatusArea` en `bottom-0 z-30` : les messages (erreur de vérification, « relancé ») passent **sous** la nav. Le board, lui, utilise `bottom-14`. | Aligner sur `board.tsx` (`bottom-14 lg:bottom-0`). | S | Haute |
| 7 | Carte | **Textes longs non repliés** : spec (markdown complet), dictation du conteneur (`whitespace-pre-wrap`), notes de **chaque** revue (markdown, toutes affichées), note de passation de **chaque** session. Une carte avec 3 revues et 3 sessions fait plusieurs écrans. | Spec repliée au-delà de ~12 lignes (« Lire tout ») ; seule la dernière revue dépliée, les autres en `<details>` ; notes de session repliées. | M | Haute |
| 8 | Éditeur | **Zoom iOS** : `input`/`textarea` en `text-sm` (14 px) ; Safari iOS zoome au focus sous 16 px (aucune règle globale dans `index.css`). Le bouton « Enregistrer » est en bas d'un scroller `max-h-[70vh]` : clavier ouvert, il est hors de vue. | `text-base` sur mobile (`sm:text-sm`) ; bouton Enregistrer collant en bas de la feuille. | S | Haute |
| 9 | Carte / diff | Liste de fichiers **non bornée** au milieu du document (avant Reprise, Revues, Journal) ; chemins tronqués **par la fin** (`truncate`) : sur `web/src/components/…` le nom de fichier, la seule partie utile, disparaît. | Afficher 8 fichiers + « N autres » ; tronquer par le début (`direction: rtl` ou nom en premier, dossier en gris). | S | Moyenne |
| 10 | Carte / journal | Plafonné en silence à 30 événements (`slice(0, 30)`), sans « voir plus » ni compteur. | « 30 sur N — tout voir ». | S | Moyenne |
| 11 | Carte | **Ordre du document** : l'alerte de doublon (« Right under the title », dit le commentaire) est rendue **après** la liste des sous-tâches, qui peut être longue — le code contredit son intention. | Placer l'alerte doublon et « copilote occupé » avant les sous-tâches. | S | Moyenne |
| 12 | Carte | **Doublons** : titre dans le fil de l'en-tête **et** en `<h1>` 26 px juste dessous ; le choix d'agent est sur la page (`AgentKindPicker`) **et** dans l'éditeur, alors que modèle et flow ne sont que sur la page. | Fil réduit à « ← Board » sur mobile ; un seul lieu pour les choix de lancement (Q2). | S | Moyenne |
| 13 | Board | Filtre **phase** actif sans signe visible : contrairement à dépôt/tag/auto, aucune puce amovible dans l'en-tête ; et l'état vide filtré teste `active \|\| activeRepo \|\| autoOnly` mais pas `activePhase` → un `?phase=` seul affiche « board vide » au lieu de « rien ne correspond ». | Puce phase amovible ; inclure la phase dans l'état vide filtré. | S | Moyenne |
| 14 | Board / tuile | Tuile jusqu'à 8 rangées (statut, titre, phase, modèle, parent, origine, dépendance, méta) ; phase et modèle chacun sur sa ligne. Sur mobile, la colonne « En cours » devient très longue. | Phase + modèle sur une même rangée de puces ; parent/origine sur une ligne. | S | Moyenne |
| 15 | Board | Colonne « Terminé » non repliée : tout ce qui n'a pas été archivé à la main est listé en bas, en entier. | Afficher les 5 dernières + « N autres ». | S | Moyenne |
| 16 | Toutes | **Zones tactiles < 44 px** : puces d'en-tête du board (`py-[5px] text-xs` ≈ 26 px), lien « PRs » de la colonne Terminé (`min-h-8`), « Restaurer » du journal (`py-[3px] text-[11px]` ≈ 22 px), rafraîchir du diff (`p-1`, ≈ 22 px), copier le prompt (`py-0.5`), « ⋯ » des sous-tâches (`size-7`), « Relancer » des PRs (`h-8`), « Ajouter un critère » et supprimer un critère de l'éditeur. | 44 px de zone (padding ou `before:` élargi) sans grossir l'icône. | S | Moyenne |
| 17 | Éditeur | Sélecteurs « Fait partie de » / « Après » : toutes les cartes du board, sans recherche, dans une liste `max-h-44`. | Champ de filtre en tête de liste. | S | Moyenne |
| 18 | Carte / journal | Le détail de « Restaurer » est indenté de `pl-[74px]` : à 390 px, l'ancien texte n'a que ~270 px. | Pas d'indentation sous `sm`. | S | Basse |
| 19 | Toutes | Textes de 10–11 px : puces de tag (`text-[10px]`), méta et dépôt des tuiles, statut des sessions, libellés de la barre latérale du conteneur. | 12 px minimum. | S | Basse |
| 20 | PRs | État vide unique : sous un dépôt sélectionné, « Aucune PR ouverte » ne dit pas qu'il s'agit de ce dépôt seulement (d'autres peuvent en avoir). | Nommer le dépôt dans l'état vide, comme le board. | S | Basse |
| 21 | Carte / diff | Une erreur de `diff/stat` autre que 409 masque toute la section (`if (error && !stat) return null`), comme le cas normal « pas démarré ». | Ne cacher que le 409 ; afficher les autres erreurs. | S | Basse |

## Ce qui est bien
Ordre mobile du board (`LANE_PHONE_ORDER` : En cours et À relire d'abord), filtres derrière un seul bouton, états vides du board qui distinguent « vide » de « filtré », `min-w-0 truncate` partout, diff qui passe à la ligne sur mobile (`whitespace-pre-wrap break-all`, pas de défilement horizontal), `.md` ouvert en lecture d'abord, éditeur avec sélecteurs repliés et champs `h-11`, zone dangereuse rangée dans « ⋯ », boutons d'action principaux en `h-9`/`h-11`.

## Options et recommandation
- **Option A — correctifs ciblés** (#2, 3, 4, 5, 6, 8, 11, 13, 16) : petites cartes S, risque faible.
- **Option B — repli des textes longs** (#7, 9, 10, 15) : un même motif « N premiers + tout voir » à réutiliser.
- **Option C — ordre mobile de la carte** (#1) : valeur élevée, touche à un choix assumé ; à lancer après Q1.

**Recommandation** : A tout de suite, B ensuite, C après réponse à Q1.

## Questions pour le propriétaire
1. Sur mobile, une carte **en cours** doit-elle montrer d'abord l'état live (pane, prompt, intégration) ou le document (spec) comme aujourd'hui ?
2. Les choix de lancement (agent, modèle, flow) vivent-ils sur la page, dans l'éditeur, ou aux deux ?
3. « Reformuler » est-il assez fréquent pour mériter l'en-tête, ou reste-t-il dans « Reprise » ?

## Limite
Rendu 390 px non vérifié. Les points 2, 4 et 6 sont à confirmer visuellement avant correction.
