# 3. Le texte de l'agent

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## 3.1 Le double wrap — mécanisme exact du problème signalé

C'est le grief « elle produit des retours à la ligne au milieu d'une ligne ». Le mécanisme :

1. **Herdr rend le pane à une largeur fixe.** Mesuré sur un vrai troupeau : médiane **81 colonnes**,
   max 233 (`hooks/use-display-prefs.ts:28-31`). Le terminal coupe donc la prose de Claude à la
   colonne 81 — un **hard wrap**, matérialisé par de vrais `\n` dans le buffer.
2. **Le bridge lit ce buffer déjà coupé.** `bridge/server.ts:430` :
   `herdr.readPane(paneId, "recent", lines, "ansi")`.
3. **Le téléphone affiche ~50 colonnes** à 12 px monospace, et le CSS recoupe :
   `whitespace-pre-wrap break-words` (`ansi-output.tsx:75`).

Résultat : une phrase est cassée **deux fois**, à deux largeurs différentes et non multiples. D'où
l'alternance ligne longue / moignon de ligne que décrit la carte. Aucun réglage de police ne la
corrige : baisser la taille de police change la seconde coupe, jamais la première.

**Herdr expose déjà la sortie de secours, et elle n'est utilisée nulle part.** `HERDR_API.md:34` :

> `pane.read` `source` ∈ `visible | recent | recent-unwrapped`

`recent-unwrapped` est déclaré dans le type du client (`bridge/herdr-client.ts:114`) et **n'est
passé par aucun appelant** — le seul lecteur de pane demande toujours `"recent"`. C'est la piste la
plus courte du document, avec une réserve sérieuse développée en Partie 2 (§B1).

## 3.2 Les tableaux ne sont pas rendus — et c'est écrit dans le code

`lib/markdown.ts:12`, textuellement :

> *Not GFM tables (they'd need real column layout on a 400px screen — they render as literal text
> lines for now)*

Donc dans l'historique, un tableau de Claude s'affiche en lignes brutes `| … | … |`. Et dans le
miroir, un tableau dessiné en box-drawing par le TUI subit le double wrap du §3.1, ce qui détruit
l'alignement des colonnes — exactement ce que décrit la carte (« les tableaux qui sont redécoupés
bizarrement »).

Note : le rendu du miroir prend déjà soin des glyphes de bordure (`ansi-output.tsx:166-169`, les
caractères box-drawing passent en `muted-foreground` pour rester visibles). L'effort existe ; il est
annulé en amont par la coupe.

## 3.3 « L'interface qui réécrit le markdown proprement » existe déjà — mais elle est morte

La carte imagine « une interface qui réécrit le markdown de Claude proprement ». **Elle est écrite,
testée, et en production** : `MarkdownText` (`markdown-text.tsx`) sur le parseur maison
`lib/markdown.ts`, rendu en éléments React (jamais de `innerHTML` — c'est la frontière XSS du dépôt,
`transcript-view.tsx:15-18`). Titres, listes, blocs de code, citations, gras/italique/code/liens
imbriqués. C'est propre.

Deux raisons pour lesquelles elle ne résout pas le problème aujourd'hui :

1. **Elle est enterrée.** On y accède par une icône 📜 dans le header du pane
   (`agent-chat.tsx:531-540`), visible uniquement si `agent.agentSessionId` existe, ou par un bouton
   « Show entire history » qu'il faut aller chercher **en remontant tout le miroir**
   (`agent-chat.tsx:666-674`).
2. **Elle est figée.** `router.tsx` désactive explicitement la revalidation pour cette route
   (`shouldRevalidate: () => false`), pour une bonne raison — re-tirer plusieurs centaines de tours
   toutes les 1,5 s serait absurde. Mais la conséquence est que **l'historique est une archive, pas
   une vue live**. On ne peut pas piloter un agent depuis là.

Il y a donc deux moteurs de rendu du même texte, l'un lisible mais mort, l'autre vivant mais illisible.

## 3.4 Le front ignore la largeur du pane

`AgentView` (`lib/types.ts:6-38`) transporte `paneId`, `status`, `cwd`, `readableLines`… mais
**aucune notion de colonnes**. Le client ne peut donc pas détecter côté navigateur qu'une ligne
pleine à exactement *N* colonnes est une ligne coupée par le terminal et non par l'auteur — la
technique standard pour dé-wrapper. Toute solution client de recollage a besoin de cette donnée.

## 3.5 Deux couleurs pour la même fonction de recherche

| Surface | Couleur du surlignage | Source |
|---|---|---|
| Miroir terminal | `bg-yellow-400` / `bg-yellow-400/30` | `ansi-output.tsx:257` |
| Historique, cartes | `bg-amber-300/70` / `dark:bg-amber-500/40` | `markdown-text.tsx:28`, `transcript-view.tsx:44` |

Même geste (chercher), même sens (voici une occurrence), deux jaunes différents.

---
