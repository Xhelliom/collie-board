# C — Chantiers moyens

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## C1. Refonte du composer — « une rangée au lieu de trois »

C'est la demande explicite de la carte (« refonte de cette partie à réfléchir »). La proposition :

**Aujourd'hui** (3 rangées permanentes, ~120 px) :

```
[View]                    🔍  ▣  ↵  A-  A+     ← 5 boutons de 28 px
[Controls]  [⌨ Keys] [⚡ Quick] [/ Agent]      ← 3 boutons de 32 px
[📎] [………… tapez ici …………]           [➤]     ← input à 270 px
```

**Proposé** (1 rangée permanente, ~56 px) :

```
[………………… tapez une réponse …………………]       ← input pleine largeur
[⌨] [⚡] [/] [+]                        [➤]   ← une rangée d'actions, 44 px
```

Les principes :

1. **L'input prend toute la largeur**, sur sa propre ligne. On regagne les 120 px de largeur perdus
   en §2.1 : on passe de ~34 à ~48 caractères par ligne, et la relecture d'une dictée tient sur
   3 lignes au lieu de 6.
2. **Une seule rangée d'actions sous l'input**, en cibles de 44 px. Send à droite, sous le pouce.
3. **Les cinq boutons View passent derrière un `+`** (ou dans le dock existant, comme un troisième
   onglet à côté de Keys/Quick). Ce sont des réglages d'affichage : on les touche une fois puis
   plus jamais — ils n'ont pas à occuper une rangée permanente. Le seul qui mérite peut-être de
   rester est « Find », et il a déjà sa place naturelle dans le header (c'est déjà là qu'il
   s'affiche une fois ouvert, `agent-chat.tsx:505`).
4. **Le trombone quitte la ligne d'input** pour rejoindre la rangée d'actions.

Bilan : **~64 px rendus au miroir** (2 lignes de terminal en plus), **+80 px de largeur d'input**
(+30 %), et **toutes les cibles à 44 px**.

À préserver impérativement (§9) : la garde à deux taps sur envoi destructeur, l'aperçu « You
sent: », l'aperçu du brouillon échoué, et le fait que Keys/Quick soient des docks **en flux** et
non des overlays — c'est ce qui permet de voir le menu qu'on pilote pendant qu'on le pilote
(`composer.tsx:83-88`, une leçon apprise à la dure d'après le commentaire).

Une variante plus prudente, si la refonte complète paraît trop large : garder la structure et
n'appliquer que (1) et (3) — l'input passe sur sa propre ligne, les boutons View vont dans le dock.
C'est ~70 % du bénéfice pour ~30 % du diff.

## C2. Les tableaux Markdown

Le parseur les a délibérément exclus (`markdown.ts:12`) pour une raison qui tient : un tableau à
5 colonnes ne rentre pas dans 400 px. Mais « ne pas les rendre » ne fait pas disparaître le
problème, ça le rend juste illisible.

Deux formes, selon la largeur, décidées à la construction de l'AST :

- **≤ 3 colonnes** : un vrai `<table>` dans un conteneur `overflow-x-auto` — le patron est déjà
  utilisé pour les blocs de code (`markdown-text.tsx:101`).
- **≥ 4 colonnes** : une **liste de cartes**, une par ligne du tableau, chaque cellule en
  `libellé : valeur`. C'est la transformation standard des tableaux responsives, et elle est bien
  plus lisible qu'un défilement horizontal au pouce.

Ajout au parseur : un bloc `{ kind: "table"; headers: MdSpan[][]; rows: MdSpan[][][] }`, la
détection de la ligne de séparation `|---|---|`, et le rendu correspondant. Le parseur est pur et
entièrement testé (`markdown.test.ts`), donc c'est du travail cadré. **La frontière XSS ne bouge
pas** : les cellules restent des `MdSpan[]` rendus en éléments React.

## C3. Hiérarchie de titres

Un `<h1>` visuellement discret (ou `sr-only`) par écran : « Herd » sur la home, « Board » sur le
board, le nom du pane sur le pane, « History » sur l'historique. Les `<h2>`/`<h3>` existants
deviennent alors cohérents. Une ligne par route.

## C4. Une barrière d'erreur par route

Ajouter `errorElement` sur `pane/:paneId`, `card/:cardId`, `board`, `pane/:paneId/history`
(`router.tsx:38-56`). Le composant `RootError` est réutilisable tel quel ; il faut juste que son
bouton renvoie vers le parent (le board, l'accueil) au lieu de recharger toute l'app. Un pane cassé
ne doit pas emporter le board.

---
