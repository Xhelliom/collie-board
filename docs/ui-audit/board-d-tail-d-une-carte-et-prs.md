# Audit UI — board, détail d'une carte, PRs (mobile 390 px)

**Méthode du rendu mobile** : **rendu réel**, avec `google-chrome-stable` local en headless contre le pont (`http://127.0.0.1:8788`), sur les données réelles du board (397 cartes) :
- captures à 390×844 (premier écran) et pleine page (390×4000 à 390×10600) de `/board`, `/board?repo=…collie-board`, `/board/prs`, et de deux cartes : `76761f43…` (à relire, agent vivant, 57 fichiers de diff, 2 revues, 2 sessions) et `1cd268ac…` (terminée, 11 sessions) ;
- mesures par le protocole DevTools (viewport 390×844, `mobile: true`, tactile émulé) : largeur de mise en page, éléments qui dépassent, position des boutons de l'en-tête, cibles tactiles < 44 px et < 32 px, recouvrement de la zone de statut par la barre de nav, position de chaque section.

**Reste lu dans le code seulement** : #8 (le zoom iOS au focus n'existe pas dans Chrome), #10, #13, #17, #18, #20, #21 (états non présents dans les données, ou interactions non jouées : aucun tap, aucun envoi, aucune vérification GitHub). Aucun code modifié.

Complète [l'audit des panes, spaces, galerie et réglages](./panes-spaces-galerie-reglages.md), qui laissait la page carte hors de son périmètre.

## Question
Les pages `board`, `board/prs` et `card/:cardId` (journal, diff, éditeur, tuiles) mettent-elles l'essentiel d'abord, replient-elles les textes longs, évitent-elles les doublons, et tiennent-elles à 390 px ?

## Constats (classés par priorité ; le # est l'identifiant stable)

| # | Page | Problème | Correction | Effort | Prio |
|---|------|----------|------------|--------|------|
| 4 | Board | **Débordement horizontal, mesuré.** Avec un dépôt sélectionné (le cas courant, ADR 0006), l'en-tête aligne puce dépôt (105 px) + « Sélectionner » (112) + « Filtrer » (74) + « + » (40) + cloche (36) dans un `flex gap-3` sans `overflow` : la page mesure **444 px** de large pour un écran de 390. Le titre « Board » disparaît, « + » et la cloche sortent de l'écran, et la page défile à l'horizontale (ou est dézoomée). Sans dépôt sélectionné, la rangée tient (390 px). | Puces de filtre actives sous l'en-tête, dans une rangée `overflow-x-auto`, ou « Sélectionner » en icône seule sous `sm`. | S | Haute |
| 1 | Carte | **Ordre mobile, mesuré** : la colonne « live » (`order-2`) vient après tout le document. Sur la carte à relire, « Intégration » (fusionner, mettre à jour la PR) est à **9 666 px** (~11 écrans) et « Classer » à 10 151 px ; sur la carte terminée, à 12 700 px. Choix assumé dans le code (« même `order` sur les deux »), d'où Q1. | Sur mobile, remonter un résumé live (pane, prompt, action principale) sous le titre ; garder l'ordre actuel à `lg`. | M | Haute |
| 7 | Carte | **Textes longs non repliés, mesuré** : la spec occupe le premier écran entier ; les notes de passation des sessions prennent ~2 900 px sur la carte à relire et **~9 400 px** sur la carte terminée (11 sessions, toutes dépliées, 9 « abandonnées ») ; chaque revue s'affiche en entier (~600 px chacune). Dictation du conteneur : idem dans le code. | Spec repliée au-delà de ~12 lignes (« Lire tout ») ; seule la dernière revue et la dernière note dépliées, le reste en `<details>`. | M | Haute |
| 9 | Carte / diff | **Liste de fichiers non bornée, mesuré** : 57 fichiers = **~2 200 px** au milieu du document, avant Reprise, Revues et Journal. Les chemins sont tronqués par la fin (vu : `server/nutrition/frequency.test.…`), ce qui cache le nom du fichier. | 8 fichiers + « N autres » ; tronquer par le début, ou nom en premier et dossier en gris. | S | Haute |
| 15 | Board | **Colonne « Terminé » non repliée, mesuré** : 323 cartes terminées sur 397. Le board sans filtre fait **55 000 px** de haut ; filtré sur collie-board (170 terminées), 27 800 px, dont tout ce qui suit 2 433 px est « Terminé ». | Les 5 dernières + « N autres ». | S | Haute |
| 2 | Carte | **En-tête trop chargé, confirmé** : « Reformuler » (122 px) et « Éditer » (86 px) gardent leur texte ; entre le retour (x 10-46) et « Reformuler » (x 70), il reste 24 px : le fil d'Ariane se réduit à « Bo », le titre de la carte n'y apparaît pas. | Icône seule sous `sm` (comme « + Nouvelle carte » du board), ou Reformuler dans « ⋯ » (cf. #3). | S | Haute |
| 6 | PRs | **Statut masqué, confirmé par mesure** : la zone de statut (z 30) se termine à y = 832, dans la barre de nav (y 773-844, z 40) : un message (erreur de vérification, « relancé ») est caché sous la nav. Le board, en `bottom-14`, place la sienne juste au-dessus (3 px de recouvrement seulement). | Aligner sur `board.tsx` (`bottom-14 lg:bottom-0`). | S | Haute |
| 5 | Carte / journal | **Textes longs illisibles, vu** : les lignes hors `run.*` sont coupées sur une ligne sans moyen de les ouvrir (vu : « Tu as dit à l'agent : « t'en penses quoi de cet… », « GitHub a refusé l'auto-merge — active « Allo… »). À l'inverse, une décision du lead (`run.*`) s'étale sur 10 lignes. `copilot.explained` (plusieurs paragraphes) est coupé comme les autres (code). | `line-clamp-2` + tap pour déplier, pour tous les types ; inclure `copilot.explained` dans le cas « wrap ». | S | Haute |
| 22 | Carte / journal | **Révélé par le rendu** : des types bruts non traduits s'affichent tels quels (`card.reopened`, `card.cleaned_up`, `card.pr_opened`, `wrapup.requested`, `wrapup.collected` : `describeEvent` retombe sur `event.type`). Les dates relatives sont en anglais (« 55m ago », « 2d ago ») dans une page en français, y compris dans Intégration (« ouverte 2d ago »). | Phrases pour ces cinq types ; `timeAgo` au catalogue i18n. | S | Haute |
| 8 | Éditeur | **Zoom iOS** (code) : `input`/`textarea` en `text-sm` (14 px) ; Safari iOS zoome au focus sous 16 px (aucune règle globale dans `index.css`). « Enregistrer » est en bas d'un scroller `max-h-[70vh]` : clavier ouvert, il est hors de vue. | `text-base` sur mobile (`sm:text-sm`) ; Enregistrer collant en bas de la feuille. | S | Haute |
| 3 | Carte | **Doublon** : « Reformuler » est dans l'en-tête **et** dans la section « Retravailler », avec le même état de confirmation. | N'en garder qu'un. | S | Haute |
| 16 | Toutes | **Zones tactiles < 44 px, mesuré** : sur la carte à relire, 86 cibles sur 90 font moins de 44 px de haut (lignes du diff ~38 px, puces, liens). Sous 32 px : lien parent « issue de… » (16 px de haut), « Copier le prompt » (76×22), « voir sur GitHub » / « résoudre sur GitHub » (17 px), interrupteur « Garder ce worktree » (44×24), rafraîchir le diff (22×22), « Défaut » (38×16), « Gérer les templates… » (16 px). Board : puces d'en-tête de 28 px. Code : « Restaurer » du journal, « ⋯ » des sous-tâches (`size-7`), « Relancer » des PRs (`h-8`). | 44 px de zone (padding ou `before:` élargi) sans grossir l'icône. | S | Moyenne |
| 23 | Carte / journal | **Révélé par le rendu** : bruit répétitif, six lignes « Passée de working à review / de review à working » d'affilée en une heure, avant les événements utiles. | Regrouper les allers-retours consécutifs (« 3 allers-retours working ↔ review »). | S | Moyenne |
| 24 | Board | **Révélé par le rendu, doublon** : le dépôt sélectionné s'affiche deux fois au premier écran, en puce amovible dans l'en-tête **et** dans le `<select>` des onglets juste dessous (et une troisième fois dans la feuille Filtrer). La puce est ce qui fait déborder l'en-tête (#4). | Supprimer la puce dépôt : le `<select>` dit déjà le filtre et permet de l'ôter. | S | Moyenne |
| 10 | Carte / journal | Plafonné en silence à 30 événements (`slice(0, 30)`), sans « voir plus » ni compteur. (code) | « 30 sur N — tout voir ». | S | Moyenne |
| 11 | Carte | **Ordre du document** : l'alerte de doublon (« Right under the title », dit le commentaire) est rendue **après** la liste des sous-tâches, qui peut être longue. Le code contredit son intention. (code) | Alerte doublon et « copilote occupé » avant les sous-tâches. | S | Moyenne |
| 12 | Carte | **Doublons** : le titre est dans le fil de l'en-tête (réduit à « Bo », #2) **et** en `<h1>` 26 px dessous ; le choix d'agent est sur la page **et** dans l'éditeur, alors que modèle et flow ne sont que sur la page. | Fil réduit à « ← Board » sur mobile ; un seul lieu pour les choix de lancement (Q2). | S | Moyenne |
| 13 | Board | Filtre **phase** actif sans signe visible : contrairement à dépôt/tag/auto, aucune puce amovible ; et l'état vide filtré teste `active \|\| activeRepo \|\| autoOnly` mais pas `activePhase`, donc un `?phase=` seul affiche « board vide » au lieu de « rien ne correspond ». (code) | Puce phase amovible ; phase incluse dans l'état vide filtré. | S | Moyenne |
| 14 | Board / tuile | Tuile jusqu'à 8 rangées (statut, titre, phase, modèle, parent, origine, dépendance, méta) ; vu : ~150-180 px par tuile, phase et modèle chacun sur sa ligne. | Phase + modèle sur une même rangée ; parent/origine sur une ligne. | S | Moyenne |
| 17 | Éditeur | Sélecteurs « Fait partie de » / « Après » : toutes les cartes du board (397 ici), sans recherche, dans une liste `max-h-44`. (code) | Champ de filtre en tête de liste. | S | Moyenne |
| 18 | Carte / journal | Le détail de « Restaurer » est indenté de `pl-[74px]` : à 390 px, l'ancien texte n'a que ~270 px. (code) | Pas d'indentation sous `sm`. | S | Basse |
| 19 | Toutes | Textes de 10-11 px : puces de tag, méta et branche des tuiles, statut des sessions, libellés de la barre latérale du conteneur ; vu lisible mais petit. Sur la carte, le dépôt est réduit à « tab… » par la branche qui le suit. | 12 px minimum ; dépôt en `shrink-0`. | S | Basse |
| 20 | PRs | État vide unique : sous un dépôt sélectionné, « Aucune PR ouverte » ne dit pas qu'il s'agit de ce dépôt seulement. (code) | Nommer le dépôt dans l'état vide, comme le board. | S | Basse |
| 21 | Carte / diff | Une erreur de `diff/stat` autre que 409 masque toute la section (`if (error && !stat) return null`), comme le cas normal « pas démarré ». (code) | Ne cacher que le 409. | S | Basse |

## Ce qui est bien (vu au rendu)
Ordre mobile du board (« Actives » puis « À relire », « À faire », « Terminé »), page PRs sobre et lisible, aucun débordement horizontal sur les cartes et les PRs (mise en page à 390 px), diff qui passe à la ligne, boutons d'intégration pleine largeur et lisibles, barre de nav qui ne masque pas la fin des listes (`pb-24`).

## Options et recommandation
- **Option A — correctifs ciblés** (#4, 24, 2, 3, 6, 22, 5, 8, 11, 13, 16) : cartes S, risque faible ; #4 + #24 se règlent ensemble.
- **Option B — repli des textes longs** (#7, 9, 10, 15, 23) : un même motif « N premiers + tout voir », qui ramène le board et la carte de dizaines d'écrans à quelques-uns.
- **Option C — ordre mobile de la carte** (#1) : valeur élevée, touche à un choix assumé ; à lancer après Q1.

**Recommandation** : A et #15 tout de suite, puis le reste de B, et C après réponse à Q1.

## Questions pour le propriétaire
1. Sur mobile, une carte **en cours** doit-elle montrer d'abord l'état live (pane, prompt, intégration) ou le document (spec) comme aujourd'hui ?
2. Les choix de lancement (agent, modèle, flow) vivent-ils sur la page, dans l'éditeur, ou aux deux ?
3. « Reformuler » est-il assez fréquent pour mériter l'en-tête, ou reste-t-il dans « Retravailler » ?

## Limite
Chrome headless n'est pas un téléphone : pas de zoom iOS (#8), pas de clavier virtuel, safe-area à 0. Aucun geste joué (feuilles, éditeur, glisser-déposer non ouverts) : leur rendu reste lu dans le code.
