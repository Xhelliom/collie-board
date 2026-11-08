# A — À faire sans discuter (quelques lignes chacune)

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## A1. Confirmer la suppression d'une carte

Le patron existe déjà dans le fichier, deux `<Section>` plus haut : `usePendingConfirm` /
l'état `confirmRework` (`card.tsx:71`, `:279-305`), qui arme un second tap et explique ce qui va se
passer. Il suffit de l'appliquer au bouton Delete — le libellé du second tap devient
« Supprimer définitivement ? ».

Ce n'est pas une question de goût : c'est le seul geste irréversible de l'app, et c'est le seul non
protégé. Le hook `usePendingConfirm` a même déjà l'auto-désarmement à 3 s.

## A2. Agrandir le rouage Settings

`app-header.tsx:118-127` : passer le bouton en `flex size-9 items-center justify-center rounded-lg`
et garder l'icône en `size-5`. On passe de 20 px à 36 px de cible sans changer un pixel de ce qui
est dessiné. C'est le même traitement que le bouton History voisin (`agent-chat.tsx:536`).

## A3. Settings monte `AppHeader`

Remplacer le `<header>` de `settings.tsx:57-69` par `<AppHeader bridge={root?.bridge}
error={root?.error} onHome={…}>`. Le `root` est déjà lu dans le composant (`settings.tsx:30`), donc
les props sont disponibles. Bénéfice direct : sur l'écran de diagnostic de connexion, on voit enfin
l'état de la connexion.

## A4. Un seul jaune de recherche

Aligner `ansi-output.tsx:257` sur la paire `amber` du transcript, ou l'inverse. Mieux : en faire
deux tokens (`--find-hit`, `--find-hit-current`) dans `index.css`, puisque le sujet des tokens
revient en §6.2 et §D2.

---
