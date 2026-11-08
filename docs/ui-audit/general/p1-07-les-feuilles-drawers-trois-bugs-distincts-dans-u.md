# 7. Les feuilles (drawers) — trois bugs distincts dans un seul fichier

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

`components/ui/sheet.tsx` implémente `BottomSheet` et `SideSheet` à la main, sans Radix ni Vaul —
choix explicite (`sheet.tsx:22` : *« no Radix, no portals, no extra deps »*). Le geste
tirer-pour-fermer est écrit à la main (`sheet.tsx:63-108`). Il contient trois défauts indépendants,
qui expliquent précisément les symptômes signalés.

**Aucun n'est couvert par les tests** : `sheet.test.tsx` teste le focus, le libellé et le rejet par
le backdrop — jsdom ne simule pas le tactile, donc tout le glissement est non testé.

## 7.1 La feuille se ferme quand on manipule un champ de saisie

Les écouteurs tactiles sont posés sur `panel` — qui est à la fois le conteneur **et** le scroller
(`sheet.tsx:100-103`). Le `touchstart` **ne filtre pas sa cible** :

```ts
const onStart = (e: TouchEvent) => {
  const t = e.touches[0];
  if (!t) return;
  drag.current = { startY: t.clientY, atTop: panel.scrollTop <= 0, engaged: false, dy: 0 };
};
```

Donc un contact qui commence **dans un `<textarea>` ou un `<input>`** arme le glissement dès que le
panneau est en haut de son défilement — le cas normal, puisque la feuille s'ouvre en haut. Six
pixels de mouvement vers le bas (`SLOP = 6`) engagent le drag, qui appelle alors `preventDefault()`
et **confisque le geste au champ** : placement du curseur, sélection de texte, défilement interne du
textarea. Au-delà de 90 px (`CLOSE`), la feuille se ferme.

Quatre feuilles contiennent des champs, dont celle qui porte le geste central du produit :

| Feuille | Champs | Source |
|---|---|---|
| **New card** (dictée) | `<textarea>` + 2 `<input>` | `new-card-sheet.tsx:136`, `:200`, `:226` |
| **Edit card** | `<textarea>` + 3 `<input>` | `card-editor.tsx:93-143` |
| New space | 2 `<input>` | `new-space-sheet.tsx:41`, `:53` |
| Agent commands | `<input>` de filtre | `command-palette.tsx:63` |

C'est exactement le symptôme décrit : « se ferme facilement quand on scrolle dans une zone d'input ».

## 7.2 Le scintillement, cause n°1 : la position de glissement n'est pas remise à zéro

`sheet.tsx:92-97` :

```ts
const onEnd = () => {
  const off = drag.current.dy;
  drag.current = { startY: 0, atTop: false, engaged: false, dy: 0 };
  if (off > CLOSE) onClose();   // ← dragY reste à `off`
  else setDragY(0);
};
```

Sur le chemin de **fermeture**, `dragY` conserve sa dernière valeur (par ex. 120 px). Le composant
n'est pas démonté — `if (!open) return null` est un simple retour anticipé, donc `useState` préserve
l'état. À la réouverture, le tout premier rendu applique donc :

- `transform: translateY(120px)` (l'état résiduel),
- `transition: transform 0.2s ease-out`,
- **et** la classe d'entrée `animate-in slide-in-from-bottom` (`sheet.tsx:143`).

`setDragY(0)` n'intervient qu'ensuite, dans l'effet, **après le premier paint**. Résultat : la
feuille apparaît décalée vers le bas puis remonte, **pendant que l'animation d'entrée joue aussi**.
Deux animations concurrentes sur la même propriété `transform`. C'est le scintillement.

## 7.3 Le scintillement, cause n°2 : l'effet se ré-exécute à chaque poll

L'effet tactile dépend de `[open, onClose]` (`sheet.tsx:108`). Or **`onClose` est une fonction
recréée à chaque rendu chez tous les appelants, sans exception** :

```tsx
routes/board.tsx:120      onClose={() => setNewOpen(false)}
routes/card.tsx:377       onClose={() => setEditing(false)}
components/agent-chat.tsx:768   onClose={closeDrawer}   // const closeDrawer = () => setDrawer(null)
components/composer.tsx:687     onClose={closeDrawer}   // idem
```

L'application revalide toutes les **1,5 s** (`use-polling.ts:13`), ce qui re-rend la route, ce qui
donne un nouveau `onClose`, ce qui relance l'effet. À chaque exécution, l'effet :

1. **retire** les quatre écouteurs tactiles, puis les **réattache** ;
2. appelle **`setDragY(0)`** (`sheet.tsx:70`).

Donc si l'utilisateur est en train de tirer la feuille quand un poll arrive, **sa position est remise
à zéro en plein geste** — la feuille saute sous le doigt. Et le cycle détacher/rattacher peut faire
perdre des événements au milieu d'un glissement.

## 7.4 Deux défauts mineurs du même composant

- **Pas de verrouillage du défilement de l'arrière-plan.** `overscroll-contain` est posé sur le
  panneau (`sheet.tsx:143`), mais rien ne bloque le document. Sur iOS Safari, l'arrière-plan défile
  derrière une modale — le symptôme classique.
- **Un `setState` par frame de `touchmove`** (`sheet.tsx:88`). Chaque frame de glissement re-rend le
  panneau **et tout son contenu** — un formulaire complet dans le cas de New card. L'écriture directe
  du `transform` via le ref éviterait React entièrement pendant le geste.

## 7.5 Le mouvement n'a aucune physique — cinq constats

C'est le point « animation trop linéaire ». Il est plus large que l'easing : le geste n'a
**aucun** des comportements qu'on attend d'un drawer.

**a) Il n'y a pas d'animation de fermeture. Du tout.** `sheet.tsx:109` et `:221` :

```ts
if (!open) return null;
```

La feuille s'ouvre en 200 ms avec `animate-in slide-in-from-bottom`, et **disparaît en 0 ms**. Il
n'y a pas un seul `animate-out` / `slide-out-to-bottom` dans le fichier. Cette asymétrie est
probablement la plus grosse part de la sensation de brutalité — plus que l'easing lui-même. Elle
touche les deux composants, et les quatre chemins de fermeture (croix, backdrop, Escape, glissement).

**b) Aucune courbe n'est choisie.** Pas une seule classe `ease-*` sur le panneau, ni nulle part dans
`components/`. L'entrée tourne donc sur le timing par défaut, et le retour de glissement sur
`ease-out` (`sheet.tsx:140`) — la courbe générique de CSS, pas une courbe de drawer. C'est
littéralement « ce qu'on obtient quand on ne décide rien ».

**c) Le retour est à durée fixe, quelle que soit la distance.** `transform 0.2s`, que la feuille
revienne de 10 px ou de 89 px. Donc un petit glissement remonte au ralenti et un grand remonte d'un
coup — l'inverse de la sensation naturelle, où la durée suit la distance parcourue.

**d) La fermeture ne regarde que la distance, jamais la vitesse.** `if (off > CLOSE)` avec
`CLOSE = 90` (`sheet.tsx:65`, `:95`). Un **flick** rapide et court — le geste le plus naturel pour
congédier quelque chose — ne ferme pas, parce qu'il n'a pas parcouru 90 px. Il faut tirer lentement
et loin. C'est le contraire de ce que fait n'importe quelle feuille native.

**e) Butée dure vers le haut.** `const off = Math.max(0, dy)` (`sheet.tsx:86`) : le mouvement est
bloqué net à zéro, sans la résistance élastique qui indique « il n'y a rien au-delà ». Et vers le
bas, le suivi est strictement 1:1 avec le doigt, sans aucune décélération à l'approche du seuil.

## 7.6 Sur grand écran, la feuille est un idiome déplacé

La `BottomSheet` est collée en bas, pleine largeur, avec des coins arrondis en haut et un plafond à
`max-h-[82dvh]` (`sheet.tsx:143`). Sur un écran de 27 pouces, un formulaire « New card » s'étale
donc sur toute la largeur, ancré au bord inférieur, avec une poignée de tirage qu'aucune souris ne
peut utiliser — et un tirer-pour-fermer qui n'a pas de sens au pointeur.

Les cinq feuilles n'ont d'ailleurs pas la même réponse desktop :

| Feuille | Idiome desktop attendu |
|---|---|
| New card, Edit card, New space | **dialog centré**, largeur bornée |
| Agent commands | palette **centrée en haut** (le geste ⌘K) |
| Tab actions, Pane actions | **popover ancré** à l'élément, pas une modale |
| Card diff | panneau large, voire pleine page |

Le premier cas est le plus fréquent et le plus choquant ; les deux autres relèvent du raffinement.

## 7.7 Vaul, ou réparer ? Le décompte honnête

**Ce que Vaul apporte, vérifié dans sa documentation** (props de `Drawer.Root`) :

| Défaut | Réponse de Vaul |
|---|---|
| §7.1 fermeture pendant la saisie | `scrollLockTimeout` (verrouille le drag après un scroll) + `handleOnly` (ne tirer que par la poignée) |
| §7.2 position résiduelle | n'existe pas — le cycle d'animation est géré |
| §7.3 effet relancé à chaque poll | n'existe pas |
| §7.4 verrou du body | actif par défaut (`noBodyStyles` pour le désactiver) |
| §7.5 physique du mouvement | **c'est le cœur de la bibliothèque** : animation de sortie, décélération, seuil de fermeture en **fraction** de hauteur (`closeThreshold`, 0.25 par défaut) plutôt qu'en pixels fixes |
| clavier | `repositionInputs`, activé par défaut — la version maison n'a rien |
| piège à focus | fourni (la version maison ne le fait pas : `sheet.tsx:7`, *« no full trap »*) |
| **§7.6 desktop** | **rien.** `direction` accepte `bottom/top/left/right` — donc un panneau latéral, jamais un dialog centré |

**Vaul règle donc sept points sur huit, mais pas le desktop.** Le patron de référence (shadcn
« Responsive Dialog ») fait cohabiter Vaul sur mobile et un Dialog sur desktop, arbitrés par un
`useMediaQuery` — donc le desktop reste à écrire dans les deux scénarios.

**Ce que réparer coûte**, ligne à ligne :

| Lot | Nature | Volume |
|---|---|---|
| §7.1–7.3 | **bugs** | ~30 lignes |
| §7.4 | verrou body + transform hors React | ~10 lignes |
| §7.5 | **physique** (sortie, vélocité, durée proportionnelle, rubber-band, courbe) | ~30 lignes **à régler empiriquement** |
| §7.6 | desktop, en classes responsives | ~12 lignes |

**Le seul lot où l'écriture maison perd vraiment est la physique.** Un bug se corrige une fois et
c'est fini ; la sensation d'un drawer se règle à tâtons, et on n'atteint pas par tâtonnement ce
qu'une bibliothèque a calibré sur des milliers d'utilisateurs. Les trente lignes de §7.5 sont
faciles à écrire et difficiles à *bien* écrire.

Recommandation en Partie 2 (§E) — elle est **révisée** par rapport à la première version de ce
document, qui sous-estimait §7.5 en la classant comme finition.

---
