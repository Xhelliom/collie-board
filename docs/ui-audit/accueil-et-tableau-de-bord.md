# Audit UI — accueil `/` et tableau de bord (mobile 390 px)

**Méthode du rendu mobile** : **rendu réel**. Captures de `/` à 390 × 844 puis 390 × 3200 (page entière) avec Chrome headless local (`google-chrome-stable --headless --window-size=390,…`) contre le pont qui tourne sur `127.0.0.1:8788`, avec les vraies données (13 panes, 8 projets). L'extension Chrome n'a pas pu servir : elle tourne sur une autre machine que le pont (page d'erreur, fenêtre restée à 1920 px). En plus des captures : lecture de `router.tsx`, `routes/home.tsx`, `home-dashboard.tsx`, `agent-list.tsx`, `agent-card.tsx`, `kpi.tsx`, `app-header.tsx`, `lib/dashboard.ts`. Aucun code modifié.

Ordre actuel à l'écran : en-tête (Herd · n panes · n spaces · cloche) → héros (phrase + anneau) → 4 KPI → triage (Needs you / Working / Idle · done) → Projets → Quota → PR ouvertes → Activité → bannière de mise à jour.

## Constats (classés par priorité ; le # est l'identifiant stable)

| # | Page | Problème | Correction | Effort | Prio |
|---|------|----------|------------|--------|------|
| 1 | Accueil | **Débordement horizontal, vu à l'écran** : tout ce qui suit les KPI dépasse le bord droit (cartes Working sans bord droit, `ctx %` coupé, colonnes repo/statut des lignes Idle hors écran, compteur et chevron « PR ouvertes » invisibles, heures de l'Activité coupées, anneau Quota décentré). Cause : la grille `grid gap-6 lg:grid-cols-[…]` de `home.tsx` n'a pas de colonne explicite sous `lg`, et ses enfants gardent `min-width:auto` ; un texte `truncate` élargit donc la piste à sa longueur entière (le piège que le commentaire d'`agent-list.tsx` décrit et corrige pour sa propre grille). Le scroller étant `overflow-y-auto`, la page se fait aussi glisser de côté au doigt. | `grid-cols-1` (ou `[&>*]:min-w-0`) sur cette grille ; ajouter un test de non-régression. | S | Haute |
| 2 | Accueil | **L'essentiel n'est pas d'abord.** Le commentaire de `home.tsx` dit que l'écran répond à « quel agent a besoin de moi », mais le premier écran (≈ 480 px) est pris par le héros et 4 KPI de **cartes** ; le triage des **agents** commence sous la ligne de flottaison. | **Décidé (D1)** : l'accueil reste d'abord le triage des agents. Ordre : héros → triage → KPI en compact (`<Kpi compact>` existe déjà, une rangée de 4) → Projets → Quota → Activité. | S | Haute |
| 3 | Accueil | **Deux sens de « bloqué » côte à côte** : le héros dit « Rien n'attend ta réponse » (panes) pendant que le KPI « Bloquées 3 » (cartes) est rouge juste dessous. Lecture contradictoire au premier coup d'œil. | Nommer l'objet dans les KPI (« Cartes bloquées ») ou rendre chaque KPI cliquable vers le board filtré, ce qui lève l'ambiguïté. | S | Haute |
| 4 | Accueil | **Langues mêlées** : héros, KPI, projets, activité en français (`useT`), mais « Herd », « n panes · n spaces », « Needs you / Working / Idle · done » (`lib/agent-groups.ts`), « No agents running. / Waiting for Herdr… » (`agent-list.tsx`) et la bannière de mise à jour sont en anglais en dur. | Passer ces chaînes au catalogue `i18n/messages/home.ts`. | S | Haute |
| 5 | Accueil | **Liste Idle · done dépliée en entier** (10 lignes ici), tous nommés « claude » : elle repousse Projets/Quota/Activité de ~400 px. | Afficher les 3-5 plus récentes + « Voir les n autres » (le tri par `statusSince` est déjà fait). | S | Moyenne |
| 6 | Accueil | **Projets : longue pile sur mobile.** 8 tuiles pleine largeur (`sm:grid-cols-2` ne joue qu'à ≥ 640 px), chaque tuile liste **toutes** ses phases en cours (5 pour `tablee`) ; les dépôts sans rien en cours (« Rien en cours · 0 phase livrée ») prennent chacun une carte entière. ~1 200 px de page. | Limiter à 2 phases par tuile + « +n » ; regrouper les dépôts au repos sur une seule ligne repliée. | M | Moyenne |
| 7 | Accueil | **Noms d'agents vides de sens** : Working et Idle · done titrent « claude » (repli de `paneDisplayName`) ; l'identifiant utile (le workspace) est en petit gris mono, et sur la carte Working il partage une ligne `truncate` avec `ctx %`, qui est coupé en premier. | Quand le nom est le repli agent, titrer par le workspace ; sortir `ctx %` en `shrink-0` comme sur `NeedsYouCard`. | S | Moyenne |
| 8 | Accueil | **Doublons** : « 13 panes » dans le sous-titre **et** « 13 agents » dans l'anneau ; « 2 cartes à relire » dans le héros **et** le KPI « À relire 2 » ; l'Activité lit le même journal (`getNotifyLog`) que la cloche juste au-dessus (badge 11) ; « Herd » (titre) et « Troupeau · en direct » (sur-titre). | Retirer le compte de panes du sous-titre (garder les spaces) ; ôter « à relire » de la phrase du héros. **Décidé (D3)** : l'Activité reste, retitrée « Dernières alertes » ; pas de lien vers la cloche, qui est déjà à un tap en haut à droite. | S | Moyenne |
| 9 | Accueil | **Zones tactiles < 44 px** : actualiser le quota `size-9` (36 px), lignes d'Activité `min-h-9` (36 px), cloche `size-9`, sélecteur de session `py-1 text-xs` (~24 px de haut). | Porter à 44 px (padding ou `before:` élargi, sans grossir l'icône). | S | Moyenne |
| 10 | Accueil | **KPI non cliquables** alors qu'ils réagissent au survol (`hover:-translate-y-0.5` sur un `div`) : affordance trompeuse, et aucun chemin de « 3 bloquées » vers ces cartes. | **Décidé (D2)** : chaque KPI devient un lien vers le board filtré sur son statut (relire, bloquées+orphelines, prêtes, livrées). Vérifier que le board sait filtrer par statut depuis l'URL ; sinon l'effort passe à M. | S | Moyenne |
| 11 | Accueil | **Notes des KPI redondantes** (« Bloquées / bloquées ou orphelines », « Prêtes / peuvent démarrer ») : elles doublent la hauteur du bloc sur mobile. | Notes masquées sous `sm` (le libellé suffit) ou en `title`. | S | Basse |
| 12 | Accueil | **Rangée « PR ouvertes » sans titre**, coincée entre Quota et le titre « Activité » (elle semble appartenir au Quota) ; affichée même à 0. | La placer sous le titre Activité ou dans Projets ; la masquer à 0. | S | Basse |
| 13 | Accueil | **États vides en double** : herd vide → le héros dit « Aucun agent en cours. » et `AgentList` affiche un bloc `py-24` « No agents running. » (anglais) juste dessous, sous 4 KPI à zéro. Pendant le chargement de l'Activité, rien n'est affiché (pas de squelette). | Un seul message vide (dans le héros) ; `emptyState={false}` sur l'accueil. | S | Basse |
| 14 | Accueil | **Bannière de mise à jour tout en bas**, après l'Activité : une mise à jour ou un redémarrage nécessaire est invisible sans défiler jusqu'au bout. | La remonter sous l'en-tête (comme `ReadOnlyBanner`). | S | Basse |
| 15 | Accueil | **Overlay de statut** `bottom-14` + `pb-[safe+0.75rem]` ≈ 68 px du bas, alors que la barre de nav fait ≈ 71 px (`min-h-14` + `pb-[safe+0.875rem]` + bordure) : chevauchement de quelques pixels, non vu (aucun statut pendant la capture). | Caler sur la hauteur réelle de la nav (variable CSS partagée). À confirmer quand un statut s'affiche. | S | Basse |

## Textes longs (point 2 de la carte)
L'accueil n'affiche **ni spec, ni journal, ni bilan, ni raison** : seuls des titres d'une ligne, tous `truncate`. Rien ne monopolise la page par sa longueur de texte ; ce sont les **listes** qui la rallongent (#5, #6). Le détail du quota est déjà replié (tap sur l'anneau).

## Ce qui est bien
Données dérivées des cartes déjà chargées (pas de poll en plus), `truncate` partout, `pb-24` du scroller qui dégage la nav, `<h1>` `sr-only`, anneaux et compteurs immobiles avec `prefers-reduced-motion`, sections vides masquées (Projets, Quota).

## Recommandation
Une carte « accueil mobile » pour #1-#4 et #7-#11 : toutes en effort S, presque toutes dans `home.tsx` et `home-dashboard.tsx`. Une seconde carte pour replier les listes (#5, #6).

## Décisions du propriétaire (2026-10-12)
- **D1** : l'accueil reste d'abord le **triage des agents** ; les KPI de cartes passent sous le triage (#2).
- **D2** : les KPI mènent au **board filtré** sur leur statut (#10).
- **D3** : laissé à l'auditeur. L'Activité **reste** sur l'accueil, retitrée « Dernières alertes », sans lien vers la cloche. Raison : elle donne le titre de la carte et y mène en un tap, ce que la cloche fait derrière un tiroir (#8).

## Hors périmètre
Rendu desktop (`lg:`, colonne de 340 px) non audité ; pages pane/spaces/galerie/réglages : voir [panes-spaces-galerie-reglages.md](./panes-spaces-galerie-reglages.md).
