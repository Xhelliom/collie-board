# Audit UI — panes, spaces, galerie, réglages (mobile 390 px)

**Méthode du rendu mobile** : lecture du code (`router.tsx`, `routes/*`, composants associés) et des classes Tailwind. Le navigateur n'était pas connecté (extension Chrome absente) : **aucun rendu réel**, donc les constats « débordement » sont déduits des classes et restent à confirmer à l'écran. Aucun fichier du code modifié.

## Question
Les pages pane / historique / artefacts / spaces / galerie / réglages mettent-elles l'essentiel d'abord, gèrent-elles les textes longs, les états vides, et tiennent-elles à 390 px ?

## Constats (classés par priorité : haute, moyenne, basse ; le # est l'identifiant stable)

| # | Page | Problème | Correction | Effort | Prio |
|---|------|----------|------------|--------|------|
| 1 | Pane (`agent-chat`) | Barre d'en-tête mobile : retour, titre, recherche, « ⋯ » en boutons `size-8` (32 px) — sous les 44 px tactiles ; sur la barre desktop 4-5 icônes de 32 px serrées. | Zones tactiles ≥ 44 px (padding/`before:` élargi) sans grossir l'icône. | S | Haute |
| 3 | Réglages | Onglet « Agents » = 7 cartes empilées (max agents, relances, auto-handoff, gate, langue, modèles, flows) : long, sans hiérarchie. La **langue** y est rangée alors qu'elle concerne l'affichage. | Déplacer Langue vers « Display » ; regrouper Modèles + Flows ; replier les blocs rares. | S | Haute |
| 5 | Réglages / Gate | Le sélecteur de **flow par défaut du dépôt** est rangé dans la carte *Gate* (`gate-control.tsx`), avec un `<select>` `h-7` (28 px) et du texte `text-xs`. Mauvais regroupement + cible tactile trop petite. | Sortir le flow par défaut vers la carte Flows, `<select>` ≥ 40 px. | S | Haute |
| 8 | Toutes (hors cartes) | **i18n incomplète** : `settings`, `gallery`, `history`, `artifacts`, `space(s)`, `agent-chat`, `space-overview`, `backup-control`, `max-agents-control` n'utilisent pas `useT` (0 occurrence) ; seuls card/project/prs/templates/flows/gate le font. Résultat : écrans mi-français mi-anglais (onglets « Display / Notifications / Agents / System »). | Passer ces écrans au catalogue (`i18n/messages/*`). | L | Haute |
| 16 | Historique | Pas de texte long replié : chaque tour est rendu en entier (fenêtre de 60 tours, +120 en remontant). Les gros tours d'outil/résultat occupent l'écran. | Replier par défaut les sorties d'outil au-delà de N lignes (« Voir tout »). Vérifier `TranscriptView` (non lu en détail). | M | Haute |
| 2 | Pane | Aucune distinction « dernier message de l'agent » vs sortie terminal brute : le miroir ANSI occupe tout l'écran, la carte liée et le statusline sont empilés sous lui, avant le composer (3 rangées de chrome). | Replier le statusline et la rangée carte en une seule ligne ; garder le miroir prioritaire. À arbitrer (cf. Q1). | M | Moyenne |
| 4 | Réglages | **Autonomie** introuvable dans Réglages : elle vit dans le panneau orchestrateur de la page projet (`autonomy-settings.tsx`, un `<details>`). Le périmètre « réglages » ne la contient pas. | Décider où elle vit (Q2) ; au minimum un lien depuis Réglages. | S | Moyenne |
| 7 | Réglages | `FlowsControl`/`TemplatesControl`/`GateControl` rendent `null` tant que le pont ne répond pas : onglet qui paraît vide, sans chargement ni erreur. | Squelette ou message « indisponible ». | S | Moyenne |
| 9 | Spaces / Space | Doublons : `spaces` affiche le compte dans l'en-tête (`n spaces`) **et** dans le titre `Spaces (n)` ; `space/:id` affiche le nom du space en en-tête **et** en `<h1>` de `SpaceView`, avec le compte tabs/panes sous l'un et l'autre. | Garder un seul titre visible (l'autre en `sr-only`). | S | Moyenne |
| 10 | Space | `SpaceStrip` + `TabStrip` + liste : deux bandes de chips défilantes avant la première carte de pane. Le plus utile (les panes) arrive après. | Fusionner en un sélecteur compact, ou replier les tabs quand il n'y en a qu'un. | M | Moyenne |
| 12 | Spaces | Bouton « nouveau space » `size-7` (28 px) ; `StatusArea` fixe à `bottom-14` au-dessus de la nav : à vérifier qu'il ne masque pas la dernière ligne (le `<main>` n'a pas de `padding-bottom` correspondant). | 44 px ; `pb-` sur le scroller. À confirmer au rendu. | S | Moyenne |
| 13 | Space | Overlay `StatusArea` en `z-30, bottom-0` alors que la nav est `fixed bottom-0 z-40` : sur mobile le statut peut passer **sous** la barre de nav. À confirmer au rendu (la page Spaces compense avec `bottom-14`, pas celle-ci). | Aligner sur `spaces.tsx`. | S | Moyenne |
| 14 | Galerie | Images en grille 3 colonnes (≈ 120 px) sans légende ni date ; groupes titrés `projet · 8 premiers caractères du session id` (illisible). Aucun filtre, aucune pagination : tout est listé. | Titre lisible (carte/date), filtre par projet, repli des groupes anciens. | M | Moyenne |
| 17 | Historique | Cinq icônes de 32 px dans l'en-tête (images, artefacts, recherche, compteur, fermer) + titre : serré à 390 px, titre tronqué. | Regrouper dans un « ⋯ » ; 44 px. | S | Moyenne |
| 6 | Réglages | Galerie atteinte uniquement par une ligne dans l'onglet « Display » : peu découvrable, mal nommée dans cet onglet. | Lien dans « System » ou entrée de nav ; décision Q3. | S | Basse |
| 11 | Space | Bouton « + » des strips `size-8` (32 px) ; état vide « (empty tab) » discret, sans action. | 44 px ; proposer « Nouveau pane » dans l'état vide. | S | Basse |
| 15 | Galerie | État vide : le texte dit « No images yet » même quand seuls des documents manquent ; le sous-titre d'en-tête ne montre « 0 images » qu'en l'absence de docs. | Un seul message vide cohérent. | S | Basse |
| 18 | Artefacts | Liste sans tri visible ni groupement ; nom + chemin relatif tronqués (`truncate`) : deux fichiers de même nom dans deux dossiers sont indiscernables. Lien « retour à la conversation » en bas, après toute la liste. | Tronquer le chemin par le **début** ; remonter le lien. | S | Basse |
| 19 | Pane | Chemin (`max-w-[12rem] truncate`, `text-[11px]`) : texte de 11 px, sous le seuil de lisibilité mobile. | 12 px minimum. | S | Basse |
| 20 | Transverse | Les écrans pane/historique/artefacts ne bornent pas la largeur (`max-w-screen-sm`) contrairement aux autres, volontairement pour le pane (commentaire en tête de `detail.tsx`) ; `history` et `artifacts` n'ont pas cette justification. | Aligner sur les autres routes. | S | Basse |

## Ce qui est bien
Onglets de Réglages (la page était trop longue), `overflow-x-auto` sur les strips, `min-w-0 truncate` partout (peu de risque de débordement horizontal), interrupteurs `h-6 w-11` ok, fenêtrage de l'historique, états vides présents sur galerie/artefacts/spaces.

## Options et recommandation
- **Option A — correctifs ciblés** (#1, 3, 5, 7, 9, 12, 13, 17) : petites cartes, risque faible. 
- **Option B — A + i18n complète** (#8) : gros diff transversal, à isoler.
- **Option C — refonte du pane mobile** (#2, 10, 16) : valeur élevée, coût élevé, à ne lancer qu'après décision du propriétaire.

**Recommandation** : A tout de suite, B dans une carte à part, C après réponse aux questions.

## Questions pour le propriétaire
1. Le pane mobile doit-il privilégier le terminal brut (état actuel) ou une vue « lecture » par défaut ?
2. L'autonomie vit-elle dans Réglages (globale) ou reste-t-elle par projet ?
3. La galerie mérite-t-elle une place dans la barre de nav ?
4. L'interface doit-elle être entièrement en français, ou le mélange est-il voulu ?

## Limite
Rendu 390 px non vérifié (pas de navigateur). Les points 12, 13 et 17 sont à confirmer visuellement avant correction.

## Hors périmètre
La page carte (`card/:cardId` : commandes de session, fusion et ouverture de la PR) n'a pas été auditée.
