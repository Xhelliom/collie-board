# E — Les feuilles

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## E1–E3. Les trois corrections qui règlent les symptômes signalés

Trois petits diffs, indépendants, dans `sheet.tsx` :

**E1 — filtrer la cible du glissement.** Un contact qui commence dans un champ, un bouton, ou une
zone défilable ne doit pas armer le tirer-pour-fermer :

```ts
const onStart = (e: TouchEvent) => {
  const t = e.touches[0];
  if (!t) return;
  // Un geste qui commence dans un champ ou un contrôle lui appartient — jamais au drawer.
  if ((e.target as Element | null)?.closest?.("input, textarea, select, button, a, [role='textbox']")) {
    drag.current = { startY: 0, atTop: false, engaged: false, dy: 0 };
    return;
  }
  drag.current = { startY: t.clientY, atTop: panel.scrollTop <= 0, engaged: false, dy: 0 };
};
```

Le sélecteur est déjà écrit ailleurs dans le dépôt, pour exactement la même raison — le tap sur le
miroir qui ne doit pas voler le geste aux contrôles (`agent-chat.tsx:486`). Le réutiliser tel quel
garde les deux endroits cohérents.

**E2 — remettre `dragY` à 0 au moment de fermer.** Une ligne :

```ts
if (off > CLOSE) { setDragY(0); onClose(); }
```

L'état résiduel disparaît, donc la réouverture ne joue plus que son animation d'entrée. Cause n°1 du
scintillement réglée.

**E3 — stabiliser `onClose`.** Deux options, la seconde préférable car elle corrige le composant
plutôt que ses appelants (donc un futur appelant ne peut pas réintroduire le bug) :

- côté appelants : `useCallback` sur les quatre `onClose` (`board.tsx:120`, `card.tsx:377`,
  `agent-chat.tsx:124`, `composer.tsx:147`) ;
- **côté `sheet.tsx`** : garder `onClose` dans un ref rafraîchi à chaque rendu, et retirer la
  dépendance de l'effet. Les écouteurs ne sont alors attachés qu'à l'ouverture, et `setDragY(0)` ne
  s'exécute plus qu'une fois. Cause n°2 du scintillement réglée, et l'effet Escape (`sheet.tsx:53-61`)
  en profite au passage.

**Écrire un test.** Le glissement n'est couvert par rien (`sheet.test.tsx` ne teste que focus,
libellé et backdrop) — ce qui est la raison pour laquelle ces trois bugs vivent tranquillement. jsdom
sait dispatcher des `TouchEvent` synthétiques : un test qui ouvre une feuille, envoie un
touchstart/move/end de 120 px **depuis un `<textarea>**, et vérifie qu'elle est toujours ouverte,
tient en quinze lignes et verrouille E1. Un second qui referme par glissement, rouvre, et vérifie
`transform` absent au premier rendu verrouille E2.

## E4. Les deux points mineurs

Verrouiller le défilement du document à l'ouverture (`document.body.style.overflow = "hidden"` dans
l'effet, restauré au cleanup — quatre lignes), et écrire le `transform` directement sur
`panelRef.current.style` pendant le glissement au lieu de passer par `setDragY`. Le second supprime
un rendu React par frame sur un panneau qui contient parfois un formulaire entier.

## E6. La physique du mouvement

Quatre correctifs, dans l'ordre d'impact ressenti :

**a) Une animation de fermeture.** C'est le plus gros gain pour le plus petit diff. Aujourd'hui la
feuille disparaît instantanément (`sheet.tsx:109`). Il faut retarder le démontage du temps de
l'animation : un état local `closing`, la classe `animate-out slide-out-to-bottom` pendant ~200 ms,
puis `return null`. Une quinzaine de lignes, et les quatre chemins de fermeture en profitent d'un
coup.

**b) Fermer sur la vélocité, pas seulement sur la distance.** Mémoriser `(dy, t)` au dernier
`touchmove` et calculer les px/ms au relâchement ; fermer si la vitesse dépasse un seuil **ou** si
la distance dépasse le seuil actuel. C'est ce qui rend le *flick* possible — le geste que tout le
monde fait en premier.

**c) Un seuil proportionnel plutôt que 90 px fixes.** Vaul emploie une fraction de la hauteur
(`closeThreshold`, 0.25 par défaut). 90 px sur une feuille de 200 px et sur une de 700 px ne
demandent pas le même engagement du poignet.

**d) Une durée de retour proportionnelle à la distance**, et une résistance élastique vers le haut
(`dy < 0 ? dy / 3 : dy` au lieu de `Math.max(0, dy)`). Plus une vraie courbe de drawer à la place du
`ease-out` générique.

**C'est le lot le plus difficile à réussir**, et la raison principale de considérer E5.

## E7. La présentation desktop des feuilles — un drawer latéral, pas un dialog

Une bottom sheet sur un écran de 27 pouces est un idiome déplacé (§7.6). La réponse retenue n'est
**pas** un second composant : c'est **le même drawer, ouvert par la droite**.

Vaul expose `direction`, et le positionnement vient des classes fournies par l'appelant — c'est le
patron de sa propre documentation :

```tsx
const position = {
  bottom: "inset-x-0 bottom-0 rounded-t-2xl max-h-[82dvh]",
  right:  "right-0 top-0 bottom-0 w-[420px] rounded-l-2xl",
};

<Drawer.Root direction={isDesktop ? "right" : "bottom"}>
  …
  <Drawer.Content className={position[isDesktop ? "right" : "bottom"]}>
```

**Pourquoi c'est meilleur qu'un dialog centré**, dans l'ordre d'importance :

1. **Sur le board en quatre colonnes (F1), un panneau latéral laisse le board visible.** Une modale
   centrée le masque. Garder sous les yeux la colonne d'où vient la carte pendant qu'on l'édite est
   fonctionnellement supérieur pour un Kanban — ce n'est pas une question de goût.
2. **Un seul composant, une seule prop.** Plus de classes responsives à écrire, et surtout plus
   besoin du patron shadcn « Responsive Dialog » (Vaul sur mobile + Radix Dialog sur desktop,
   arbitrés par un `useMediaQuery`) — la même instance couvre les deux.
3. **L'idiome latéral est déjà dans le vocabulaire de l'app** : `SideSheet` existe
   (`sheet.tsx:234`, `slide-in-from-left`, pour le ThreadSidebar). Cette piste **unifie** deux
   composants aujourd'hui séparés au lieu d'en ajouter un troisième.

**Ce qu'il reste à écrire** : un `useMediaQuery`. Le dépôt n'en a pas — il lit `window.innerWidth`
une seule fois, sans réactivité (`use-display-prefs.ts:46`). Une dizaine de lignes sur `matchMedia`
+ `useSyncExternalStore`, réutilisables ensuite par F1 et F2.

**Deux réserves, mineures :**

- La **palette de commandes** reste mal servie par un panneau latéral — l'idiome desktop d'un ⌘K est
  centré-haut. Une feuille sur neuf ; à traiter séparément, si tant est qu'on y tienne.
- Changer `direction` **pendant qu'un drawer est ouvert** (redimensionnement de fenêtre, rotation
  d'une tablette) est un cas limite à vérifier une fois. En pratique : rare, et sans conséquence
  au-delà d'une animation bancale.

**Conséquence sur l'arbitrage Vaul** : la version précédente de ce document disait « Vaul règle sept
points sur huit, mais pas le desktop ». **Avec le drawer latéral il les règle tous les huit** —
l'argument « le desktop reste à écrire dans les deux cas » tombe, et la décision §E5 s'en trouve
renforcée.

## E5. Vaul — la recommandation, révisée

La première version de ce document recommandait « réparer, puis juger sur pièce », en classant
l'animation comme de la finition. **L'examen du code a changé la pesée** : il n'y a aucune animation
de fermeture, aucune vélocité, aucune courbe choisie (§7.5). Ce n'est pas de la finition, c'est la
moitié de la sensation — et c'est précisément ce que décrit la demande.

Le coût de Vaul, inchangé et réel :

- **deux dépendances** (`vaul` + `@radix-ui/react-dialog`, sa pair-dépendance) dans un
  `package.json` runtime qui en compte sept — sur une PWA dont l'argument est de tenir dans un budget
  mobile ;
- **l'abandon d'un choix explicite** (`sheet.tsx:22`), qui mérite un **ADR**, pas un commit — le
  dépôt a exactement ce format pour ça (`.adr/`) ;
- Radix Dialog **portale** à la racine du document, donc l'empilement des feuilles et les cinq sites
  d'appel sont à revérifier ;
- et **le desktop reste à écrire** (E7) dans les deux cas.

**Décision retenue (2026-07-29) : oui à Vaul, sous trois conditions.** La qualité du geste est un
objectif explicite, et c'est le seul lot où l'écriture maison perd structurellement — un bug se
corrige une fois, une sensation se règle à tâtons. Deux points renforcent le choix et n'avaient pas
été pesés plus haut :

- **`repositionInputs`** : quatre feuilles sur cinq ont des champs, et la version maison ne fait
  *rien* pour le clavier. Sur une app dont le geste central est de dicter dans une bottom sheet, ce
  n'est pas du confort.
- **Le garde-fou `backdropArmed`** (`sheet.tsx:41-49`) devient gratuit : c'est une réimplémentation
  manuelle de la règle outside-pointerdown de Radix — le commentaire du code le dit lui-même. Une
  trentaine de lignes maison disparaissent avec la migration.

**Condition 1 — E1–E3 d'abord, sans attendre la migration.** Ce sont des bugs, pas des préférences,
et ils cassent la saisie dans la feuille de dictée. ~30 lignes plus les deux tests tactiles
manquants. La migration, elle, touche **neuf sites d'appel**, les **neuf tests existants** de
`sheet.test.tsx` (qui testent le comportement maison et deviendraient des tests de Vaul), et demande
un ADR : c'est une carte à part entière. Si elle met des semaines à remonter dans le planning, ce
sont des semaines de dictée cassée pour rien.

**Condition 2 — un ADR, pas un commit.** *« no Radix, no portals, no extra deps »* est écrit dans
`sheet.tsx:22`. `.adr/` existe précisément pour les décisions qui ferment une option que quelqu'un
reproposera ; sans ADR, le prochain contributeur re-renversera le choix dans l'autre sens.

**Condition 3 — mesurer le bundle avant de s'engager.** Vaul + Radix Dialog sur une PWA servie par
tailscale : le chiffre n'est pas dans ce document et ne doit pas être deviné. Un build avant/après le
donne, et c'est le seul argument contre qui soit factuel plutôt que doctrinal.

**Ce que la migration règle en plus, depuis la révision de E7** : le desktop. Avec
`direction="right"` sur grand écran, la même instance couvre mobile et desktop — donc Vaul répond
aux **huit** défauts de §7, et non sept. Seul reste à écrire un `useMediaQuery` (~10 lignes).

**Ce qu'elle rend sans objet** : E6, sauf **E6a** (l'animation de fermeture), qui vaut le coup
**tout de suite** si la migration n'est pas immédiate — ~15 lignes pour supprimer la disparition
instantanée.

**Risque assumé, non bloquant** : dépendance UI d'un seul mainteneur, sur une application destinée à
durer.

Ce qui ne se défend pas, en revanche, c'est l'ordre inverse : adopter Vaul pour contourner trois bugs
de trente lignes, sans avoir décidé qu'on voulait sa physique. La décision porte sur §7.5, pas sur
§7.1–7.3.

---
