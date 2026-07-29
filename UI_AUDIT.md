# Audit de l'interface — Collie Board 0.40.0

> Document en français : c'est la langue de la demande. Le reste du dépôt reste en anglais.
> Rédigé le 2026-07-29 sur la branche `board/auditer-l-interface-complete-et-livrer-une-revue`.
>
> **Ce document n'implémente rien.** C'est un état des lieux + une revue de pistes. Chaque constat
> cite `fichier:ligne` pour être vérifiable, contestable, et actionnable séparément.

## Méthode et limites

L'audit est une **lecture de code** : les 96 fichiers de `web/src/` (composants, routes, hooks,
lib), plus `index.html`, `index.css`, et les points du bridge qui déterminent ce que l'interface
reçoit (`bridge/server.ts`, `HERDR_API.md`).

Les mesures en pixels sont **dérivées des classes Tailwind**, pas d'un rendu réel sur appareil
(`h-7` → 28 px, `py-2` → 16 px, base 16 px). Elles sont justes à quelques pixels près pour ce qui
est de la hauteur des barres ; elles n'intègrent pas les hauteurs de ligne exactes des textes. Un
passage sur un vrai téléphone confirmerait les totaux — il ne changerait pas les ordres de grandeur.

Ce qui n'est **pas** couvert : les performances mesurées (pas de profilage), le rendu réel sur iOS
Safari vs Chrome Android, et l'accessibilité testée au lecteur d'écran (les constats a11y ci-dessous
sont structurels, lus dans le DOM produit).

---

## Résumé

L'interface est **bien pensée sur le fond et sous pression sur la forme**. Le raisonnement dans le
code est d'un niveau qu'on voit rarement : le gel du miroir pendant qu'on lit, le garde-fou de
course sur les menus de prompt, la stabilisation du brouillon échoué sur la ligne `❯`, le
dé-bounce des revalidations, le respect systématique de `safe-area-inset`. Rien de ce qui suit ne
remet ça en cause.

Le problème est ailleurs, et il est **structurel** : sur l'écran pane — le seul écran qui compte —
**onze bandes de chrome** se partagent la hauteur avec le miroir, qui est pourtant la seule raison
d'ouvrir cet écran. Chaque bande a une bonne justification prise isolément. Prises ensemble, elles
laissent au contenu environ **45 % de la hauteur, et 30 % clavier ouvert**.

Les huit griefs signalés sont tous réels, et l'audit en donne la mesure et la cause :

| Signalé | Cause trouvée |
|---|---|
| Input rogné à droite et à gauche | 31 % de largeur mangée par deux boutons (§2.1) |
| Boutons trop petits | 5 cibles de 28 px, sous Apple et Material (§2.2) |
| Retours à la ligne au milieu d'une phrase | **double wrap** : herdr coupe à 81 colonnes, le CSS recoupe à 50 (§3.1) |
| Tableaux disloqués | même double wrap, plus le parseur qui les exclut explicitement (§3.2) |
| Le drawer scintille et se ferme tout seul | **trois bugs distincts**, aucun couvert par un test (§7.1-7.3) |
| Le mouvement du drawer est trop linéaire | **aucune animation de fermeture**, ni vélocité, ni courbe choisie (§7.5) |
| Pas de mode desktop | `max-w-screen-sm` sur les 5 routes ; et 8 colonnes de board à regrouper (§F) |
| Board et sessions ne disent pas la même chose | le contexte n'est calculé que pour les panes nés d'une carte (§8) |

Il relève en plus **dix problèmes non signalés**, dont un de gravité supérieure à tous les autres :
**la suppression d'une carte se fait en un tap, sans confirmation**, dans une application où tous
les autres gestes destructeurs — bien moins graves — en demandent deux.

Deux constats orientent les corrections. D'abord, **une bonne partie de ce qui manque existe déjà**
et n'est pas branchée : le rendu Markdown propre (`TranscriptView`, enterré et figé), la jauge de
contexte (montée sur un seul écran sur quatre), et jusqu'à `pane.read source: "recent-unwrapped"`
côté herdr, déclaré et jamais appelé. Ensuite, **les bugs les plus visibles sont les moins chers** :
les trois défauts du drawer tiennent en une trentaine de lignes dans un seul fichier.

---

# Partie 1 — Audit

## 1. Le budget d'écran : le problème de fond

### 1.1 Onze bandes pour un contenu

Ce que l'écran pane empile, de haut en bas (`agent-chat.tsx:492-763`) :

| # | Bande | Source | Hauteur ≈ | Permanente ? |
|---|-------|--------|-----------|--------------|
| 1 | `AppHeader` | `app-header.tsx:66` | 56 px + safe-top | oui |
| 2 | `StatusArea` | `agent-chat.tsx:596` | 0 ou 30 px | non |
| 3 | `ReadOnlyBanner` | `agent-chat.tsx:599` | 0 ou ~40 px | non |
| 4 | `TabStrip` | `agent-chat.tsx:604` | 48 px | oui (si un agent) |
| 5 | `PaneStrip` | `agent-chat.tsx:624` | 40 px | si >1 pane |
| — | **le miroir** | `agent-chat.tsx:642` | *le reste* | — |
| 6 | handle swipe | `agent-chat.tsx:727` | 34 px | oui |
| 7 | statusline agent | `agent-chat.tsx:737` | ~22 px | si Claude |
| 8 | composer · rangée View | `composer.tsx:474` | 36 px | oui |
| 9 | composer · rangée Controls | `composer.tsx:565` | 40 px | oui |
| 10 | composer · dock Keys/Quick | `composer.tsx:550-563` | 0 → 45 dvh | non |
| 11 | composer · rangée input | `composer.tsx:615` | 44 px + paddings | oui |

**Chrome permanent** : ~104 px en haut (hors safe-area), ~195 px en bas (hors safe-area). Sur un
iPhone 14 en PWA (≈ 780 px de hauteur utile, safe-areas comprises) : **le miroir reçoit ~430 px**,
soit 55 % — et il en donne 15 lignes à 12 px, pour un pane qui en compte 51.

**Clavier ouvert** (≈ 300 px sur iOS), grâce à `interactive-widget=resizes-content`
(`index.html:6`) le layout se comprime au lieu de glisser — c'est le bon choix — mais il reste
alors **~130 px de miroir, soit 4 à 5 lignes**. On tape une réponse en voyant 4 lignes de ce à quoi
on répond.

C'est la lecture chiffrée du grief « la zone d'input est rognée » : elle n'est pas seulement rognée
en largeur, elle est prise dans un empilement qui rogne surtout le contenu.

### 1.2 Deux affordances pour le même geste

Changer de pane est offert **deux fois** sur le même écran :

- la `PaneStrip`, une bande d'onglets sous les tabs (`agent-chat.tsx:624-636`) ;
- le handle swipe-up + `BottomSheet` « Switch pane » (`agent-chat.tsx:721-731` et `:768-776`).

Elles font strictement le même travail. Le handle est monté dès qu'**un seul** pane existe
(condition `agents.length + shellPanes.length > 0`, jamais `> 1`), donc il coûte ses 34 px même
quand il n'y a rien vers quoi basculer.

---

## 2. Le composer — les points signalés, mesurés

### 2.1 La largeur d'input (« rognée à droite et à gauche »)

La rangée est `[trombone] gap-2 [textarea] gap-2 [Send]` dans un conteneur `px-3`
(`composer.tsx:615-681`) :

```
390 px (iPhone 14)
 − 24  px-3 (conteneur)
 − 36  bouton trombone (size icon = size-9)
 − 44  bouton Send (size-11)
 − 16  deux gap-2
 ─────
 270 px pour le textarea
```

À 16 px (`text-base` sur `ChatInput`, `chat-input.tsx:17`), c'est **~34 caractères par ligne**.
Une instruction dictée de deux phrases occupe 5 à 6 lignes dans une boîte plafonnée à `max-h-40`
(160 px) — donc elle défile déjà avant d'être finie. La perte est de **31 %** de la largeur
disponible, pour deux boutons dont un (le trombone) sert épisodiquement.

### 2.2 La taille des boutons (« les boutons sont petits »)

La rangée **View** aligne 5 boutons `h-7 w-7` = **28 × 28 px**, espacés de `gap-1` = 4 px
(`composer.tsx:481-542`) :

| Référence | Seuil | 28 px |
|-----------|-------|-------|
| WCAG 2.2 AA · 2.5.8 Target Size (Minimum) | 24 × 24 | passe |
| Material Design | 48 × 48 | **échoue** |
| Apple HIG | 44 × 44 | **échoue** |

Cinq cibles sous-dimensionnées, contiguës, dans le coin bas-droit de l'écran — c'est-à-dire là où
le pouce est le moins précis. La rangée **Controls** juste en dessous est en `h-8` (32 px), donc
également sous les deux seuils plateformes.

À côté de ça, le `NavTray` (le pavé de touches) est correctement dimensionné : `h-10` et `h-12`
partout (`nav-tray.tsx:113`, `:262`). Le problème n'est donc pas une habitude générale — il est
concentré sur les deux rangées permanentes du composer.

### 2.3 La rangée Controls est payée en permanence pour un usage épisodique

Keys / Quick / Agent (`composer.tsx:565-604`) occupent une rangée pleine 100 % du temps ; leur
contenu ne s'ouvre que sur tap. Trois boutons `flex-1` + un `SectionLabel` qui ne pilote rien
consomment 40 px en continu pour ce qui est fonctionnellement un menu.

Même remarque pour le `SectionLabel` « View » (`composer.tsx:475`) : il consomme de la largeur pour
étiqueter cinq icônes qui portent déjà chacune un `aria-label` et un `title`.

---

## 3. Le texte de l'agent

### 3.1 Le double wrap — mécanisme exact du problème signalé

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

### 3.2 Les tableaux ne sont pas rendus — et c'est écrit dans le code

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

### 3.3 « L'interface qui réécrit le markdown proprement » existe déjà — mais elle est morte

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

### 3.4 Le front ignore la largeur du pane

`AgentView` (`lib/types.ts:6-38`) transporte `paneId`, `status`, `cwd`, `readableLines`… mais
**aucune notion de colonnes**. Le client ne peut donc pas détecter côté navigateur qu'une ligne
pleine à exactement *N* colonnes est une ligne coupée par le terminal et non par l'auteur — la
technique standard pour dé-wrapper. Toute solution client de recollage a besoin de cette donnée.

### 3.5 Deux couleurs pour la même fonction de recherche

| Surface | Couleur du surlignage | Source |
|---|---|---|
| Miroir terminal | `bg-yellow-400` / `bg-yellow-400/30` | `ansi-output.tsx:257` |
| Historique, cartes | `bg-amber-300/70` / `dark:bg-amber-500/40` | `markdown-text.tsx:28`, `transcript-view.tsx:44` |

Même geste (chercher), même sens (voici une occurrence), deux jaunes différents.

---

## 4. Gestes destructeurs — l'incohérence la plus grave de l'audit

**« Delete card » supprime en un tap, sans confirmation.** `routes/card.tsx:366-371` :

```tsx
<Section label="Danger zone">
  <Button variant="outline" size="sm" className="h-9 gap-2 text-destructive" onClick={remove}>
    <Trash2 className="size-4" />
    Delete card
  </Button>
</Section>
```

`remove()` (`card.tsx:133-137`) appelle `deleteCard` puis navigue vers le board. Pas de second tap,
pas de feuille de confirmation, pas d'annulation. Une carte porte spec, critères d'acceptation,
journal, historique de sessions et notes de handoff — c'est l'objet **durable** du produit, celui
qui « survit au pane qui travaille dessus » (`board.tsx:20`).

Ce qui rend le constat sévère, c'est le **contraste avec le reste de l'application**, qui protège
scrupuleusement des gestes bien moins graves :

| Geste | Réversible ? | Protection | Source |
|---|---|---|---|
| Envoyer `rm -rf` dans un terminal | non, mais visible | **deux taps** | `composer.tsx:364-372` |
| Ctrl-D / Ctrl-Z dans le pavé de touches | oui | **deux taps** | `nav-tray.tsx:79-83` |
| Reformuler (écrase une édition manuelle) | **oui**, via le journal | **deux taps + explication** | `card.tsx:279-305` |
| Fermer un onglet / un pane | l'agent redémarre | feuille d'action | `tab-actions-sheet.tsx` |
| **Supprimer une carte** | **non** | **aucune** | `card.tsx:367` |

Le seul geste réellement irréversible de l'application est le seul sans garde-fou. Sur un téléphone,
où le tap accidentel est le mode de défaillance principal, et où le bouton est atteignable en
scrollant jusqu'au bas d'une page qu'on parcourt au pouce.

---

## 5. Accessibilité

### 5.1 Le rouage Settings est sous le minimum absolu

`app-header.tsx:118-127` : un `<button>` **sans aucun padding**, dont le seul contenu est
`<Settings className="size-5" />`. La cible fait donc **20 × 20 px** — c'est **sous le minimum
WCAG 2.2 AA (24 × 24)**, pas seulement sous les guides plateformes. Elle est placée dans le coin
haut-droit, contre le bord de l'écran, sur trois écrans (home, board, space).

Les autres boutons du même header sont en `size-8` (`agent-chat.tsx:536`) : le rouage est une
exception, pas une convention.

### 5.2 Hiérarchie de titres cassée

Deux `<h1>` dans toute l'application : `routes/card.tsx:177` et `routes/settings.tsx:67`. Les
écrans principaux — **home, board, pane, historique, space** — n'en ont aucun. Pire, ils portent des
`<h2>` (`agent-list.tsx:50`, `space-overview.tsx:24`) et des `<h3>` (`space-view.tsx:36`,
`agent-sidebar.tsx:90`) **sans `<h1>` parent** : un lecteur d'écran qui navigue par titres tombe sur
une arborescence orpheline (WCAG 1.3.1).

### 5.3 Le statut d'erreur n'est pas atteignable au clavier

`status-area.tsx:29-49` : la bande de statut est un `<div role="status" aria-live="polite">` sur
lequel un `onClick` est posé quand le ton est `error`. Pas de `<button>`, pas de `tabIndex`, pas de
gestion de `Enter`/`Espace`, et la croix `<X>` n'a pas de label. C'est la **seule chose de
l'application qu'on doive activement écarter** (les autres tons s'effacent seuls), et c'est la seule
qui ne soit pas activable au clavier.

### 5.4 Ce qui est bien fait, pour être juste

`prefers-reduced-motion` est respecté **partout** (`index.css:145`, `:200`, et jusque dans le splash
inline de `index.html:52`). Les feuilles gèrent le focus à l'ouverture et le restaurent à la
fermeture (`sheet.tsx:11-21`). Les backdrops sont `aria-hidden` pour ne pas doubler le bouton de
fermeture (`sheet.tsx:129-131`). `aria-pressed` / `aria-expanded` sont posés correctement sur les
bascules du composer. Ce n'est pas une interface négligée sur ce plan — les quatre points ci-dessus
sont des trous, pas une tendance.

---

## 6. Cohérence du système visuel

### 6.1 Le mode clair est du code mort

`index.html:2` force `<html lang="en" class="dark">` **en dur**. Les ~20 tokens de la palette claire
(`index.css:6-32`) ne sont donc **jamais atteints**, et `prefers-color-scheme` n'est lu nulle part.

Ce n'est pas un bug — c'est un choix défendable pour une app qu'on ouvre la nuit depuis son lit.
C'est un **piège** : la moitié du fichier de tokens décrit une réalité qui n'existe pas, et
plusieurs composants portent des variantes `dark:` (`markdown-text.tsx:28`) qui suggèrent le
contraire. Soit on assume et on supprime, soit on branche.

### 6.2 Deux surfaces échappent aux tokens

`bg-zinc-800` en dur dans le header (`app-header.tsx:66`) et dans le composer
(`composer.tsx:454`) — les deux seules surfaces de l'application qui ne suivent pas `--background`.
Ce sont, ironiquement, les deux surfaces de chrome permanentes. Ajouté à `bg-zinc-500/40` dans
`collie-home.tsx:47`.

De même, `text-yellow-500` pour les avertissements dans trois blocs de dialogue
(`multi-select-block.tsx:161`, `preview-select-block.tsx:193`, `wizard-block.tsx:216`) alors qu'il
existe un token `--status-working` prévu exactement pour cet usage (`index.css:28`).

### 6.3 La page Settings a son propre header

`routes/settings.tsx:57-69` monte un `<header>` copié-collé au lieu d'`AppHeader`. Conséquences :

- pas de marque Collie ni de retour à l'accueil par le logo ;
- **pas d'indicateur de connexion** — ni le galop du chien, ni la bannière.

C'est le seul écran de l'app où l'on ne peut pas voir que le pont ne répond plus. Or c'est
précisément l'écran où l'on va quand quelque chose ne va pas : il héberge `ConnectionInfo`, le
diagnostic de connexion (`settings.tsx:112`).

Le commentaire d'`AppHeader` dit pourtant l'intention (`app-header.tsx:51-56`) : *« The single header
shell every screen mounts […] so no caller can forget it »*. Un appelant l'a oublié.

### 6.4 Aucun moyen de copier quoi que ce soit

Recherche de `navigator.clipboard` dans `web/src/` : **une seule occurrence**, dans la bannière de
mise à jour (`update-banner.tsx`), pour copier une commande shell.

Il n'y a donc pas de bouton copier :

- sur le miroir terminal, ni sur une ligne de sortie ;
- sur un bloc de code du transcript (`markdown-text.tsx:100-106`) — pourtant `<pre>`, donc
  identifiable ;
- sur un chemin de fichier, un nom de branche (`card-tile.tsx:66`), un `cwd`.

Et la sélection manuelle, la seule voie restante, est doublement pénalisée sur mobile : le miroir
est un `<pre>` à défilement horizontal (`ansi-output.tsx:81`), et le tap sur le miroir **ouvre le
clavier** (`agent-chat.tsx:484-490`) — le code prend soin de ne pas le faire quand une sélection est
en cours, mais il faut avoir réussi la sélection d'abord.

Sur un outil dont le but est de piloter un agent depuis son téléphone, ne pas pouvoir récupérer un
chemin ou une commande que l'agent vient d'écrire est une lacune de fond.

### 6.5 Une seule barrière d'erreur pour toute l'application

`router.tsx:33` : un unique `errorElement: <RootError />`, à la racine. Aucune route enfant n'a le
sien. Une erreur de loader ou de rendu dans **n'importe quel** écran — un pane, une carte,
l'historique — vide donc l'application entière et propose « Reload » (`root.tsx:96-118`). On perd
le board et l'accueil parce qu'un pane a eu un souci.

---

## 7. Les feuilles (drawers) — trois bugs distincts dans un seul fichier

`components/ui/sheet.tsx` implémente `BottomSheet` et `SideSheet` à la main, sans Radix ni Vaul —
choix explicite (`sheet.tsx:22` : *« no Radix, no portals, no extra deps »*). Le geste
tirer-pour-fermer est écrit à la main (`sheet.tsx:63-108`). Il contient trois défauts indépendants,
qui expliquent précisément les symptômes signalés.

**Aucun n'est couvert par les tests** : `sheet.test.tsx` teste le focus, le libellé et le rejet par
le backdrop — jsdom ne simule pas le tactile, donc tout le glissement est non testé.

### 7.1 La feuille se ferme quand on manipule un champ de saisie

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

### 7.2 Le scintillement, cause n°1 : la position de glissement n'est pas remise à zéro

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

### 7.3 Le scintillement, cause n°2 : l'effet se ré-exécute à chaque poll

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

### 7.4 Deux défauts mineurs du même composant

- **Pas de verrouillage du défilement de l'arrière-plan.** `overscroll-contain` est posé sur le
  panneau (`sheet.tsx:143`), mais rien ne bloque le document. Sur iOS Safari, l'arrière-plan défile
  derrière une modale — le symptôme classique.
- **Un `setState` par frame de `touchmove`** (`sheet.tsx:88`). Chaque frame de glissement re-rend le
  panneau **et tout son contenu** — un formulaire complet dans le cas de New card. L'écriture directe
  du `transform` via le ref éviterait React entièrement pendant le geste.

### 7.5 Le mouvement n'a aucune physique — cinq constats

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

### 7.6 Sur grand écran, la feuille est un idiome déplacé

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

### 7.7 Vaul, ou réparer ? Le décompte honnête

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

## 8. Board et session : deux vues du même agent qui ne disent pas la même chose

Un agent apparaît sous deux formes — `AgentCard` (accueil, vue espace) et `CardTile` (board) — et
elles n'affichent ni les mêmes champs, ni les mêmes champs disponibles.

| Information | `AgentCard` (accueil) | `CardTile` (board) | Page pane | Page carte |
|---|---|---|---|---|
| Statut de l'agent | ✅ | ✅ (si pane vivant) | ✅ | ✅ |
| Répertoire (`cwd`) | ✅ | ❌ | ✅ | ✅ |
| Branche git | ❌ | ✅ | ❌ | ✅ |
| Espace / workspace | ✅ | ❌ | ✅ (fil d'Ariane) | ❌ |
| Nombre de sessions | ❌ | ✅ | ❌ | ✅ |
| **Contexte utilisé (`ctx %`)** | **❌** | **✅** | **❌** | **✅ (jauge)** |

Sources : `agent-card.tsx:36-57`, `card-tile.tsx:57-71`, `agent-chat.tsx:569-581`, `card.tsx:196-198`.

### 8.1 Le contexte est l'exemple le plus net, et il est à l'envers

Le pourcentage de contexte est une propriété **de la session de l'agent** — pas de la tâche. Or il
n'est visible que sur les deux écrans « tâche » (board, carte), et **absent des deux écrans
« agent »** (accueil, pane).

C'est l'inverse de l'usage : on décide de passer la main (`handoff`) **quand on regarde l'agent
travailler**, pas quand on parcourt le board. Et l'écran pane est justement celui où la décision se
prend — il porte le composer, on y voit l'agent ramer.

Le seul substitut sur l'écran pane est la statusline brute de Claude, ré-affichée en texte monospace
(`agent-chat.tsx:736-740`) : elle contient parfois un `ctx%`, **si** Claude l'affiche, **si** la
grammaire l'extrait, et sans aucune mise en forme — pas la jauge colorée avec ses seuils à 70/85 %
qui existe pourtant (`context-gauge.tsx`).

### 8.2 La cause est dans le bridge, pas dans l'UI

`bridge/context.ts:84` :

```ts
const due = this.db.listOpenSessions().filter((s) => { … });
```

Le `ContextTracker` n'itère **que sur les sessions ouvertes en base**, c'est-à-dire les panes
démarrés **depuis une carte**. Conséquence en deux temps :

1. Un pane lancé à la main (nouvel onglet dans Collie, ou depuis herdr) **n'a jamais de contexte**,
   quelle que soit la vue. Ce n'est pas un problème d'affichage : le chiffre n'est jamais calculé.
2. Même pour un pane adossé à une carte, le chiffre est écrit dans `card_session` en base
   (`context.ts:107`) — donc il ne remonte que par l'API board, jamais par le snapshot du troupeau
   qui alimente `AgentView`.

Détail savoureux : le tracker **pousse déjà** ce chiffre dans herdr via `pane.report_metadata`
(`context.ts:140-147`), pour qu'il s'affiche en `$ctx` dans la barre latérale du TUI. **L'information
est donc visible dans le terminal herdr, et invisible dans l'app Collie qui l'a calculée.**

### 8.3 Les autres écarts, moins graves mais du même ordre

- **La branche git** est sur la carte du board mais pas sur celle de l'accueil, alors que le pane
  tourne dans un worktree — c'est souvent la seule chose qui distingue deux panes du même dépôt.
- **Le `cwd`** est sur la carte de l'accueil mais pas sur celle du board — l'exact miroir.
- **Le nom affiché** suit deux règles différentes : `paneDisplayName()` pour un pane (libellé
  utilisateur → nom `/rename` de Claude → nom d'agent, `types.ts:45-49`), et `card.title` pour une
  carte. Un même agent porte donc deux noms selon l'écran, sans lien visible entre les deux.

Aucun de ces écarts n'est absurde pris isolément — chaque vue montre ce que sa source de données
porte. Mis bout à bout, ils font que **la même chose ne se lit pas pareil selon la porte d'entrée**,
alors que le board se présente explicitement comme « une seconde lentille sur le même troupeau »
(`card-tile.tsx:10-11`).

---

## 9. Ce qui est solide (et qu'il ne faut pas casser en corrigeant le reste)

Un audit qui ne liste que des défauts donne une fausse image. Ce qui suit est au-dessus de la
moyenne du métier et contraint les propositions de la Partie 2 :

- **Le gel du miroir** (`agent-chat.tsx:144-155`) : dès qu'on remonte pour lire, le texte est figé
  avec sa `revision`, en paire cohérente. C'est ce qui permet de lire un long message sans qu'il
  glisse hors de la fenêtre glissante.
- **Le garde-fou de course sur les prompts** (`agent-chat.tsx:312-339`) : un tap sur une option de
  menu re-lit le pane et re-dérive le menu avant d'envoyer la touche. Un menu qui a bougé annule le
  tap au lieu d'approuver la mauvaise option.
- **Le brouillon échoué sur la ligne `❯`** (`composer.tsx:128-263`) : détection, stabilisation sur
  1,5 s, suppression de l'écho de son propre envoi, aperçu en lecture seule, reprise explicite. Une
  centaine de lignes pour un cas limite que personne n'aurait vu venir — et qui corrompait les envois.
- **La frontière XSS, explicite et défendue** : texte d'agent → nœuds texte React, jamais de HTML.
  Écrit dans `CLAUDE.md`, redit dans `ansi-output.tsx:88` et `transcript-view.tsx:15`, et c'est la
  raison pour laquelle le parseur Markdown est écrit à la main plutôt qu'importé.
- **`safe-area-inset` systématique**, y compris en bas des feuilles et du composer.
- **La discipline de polling** : `useRevalidator` sur cadence adaptative, jamais de boucle
  parallèle, auto-guérison d'une revalidation bloquée (`use-polling.ts:79-88`), refus délibéré de
  se fier à `navigator.onLine` avec l'explication du bug réel qui l'a motivé.

---

# Partie 2 — Revue : pistes d'amélioration

Classement par **valeur perçue ÷ risque**. « Risque » = surface upstream touchée + probabilité de
casser une des mécaniques du §9.

| # | Piste | Répond à | Effort | Risque |
|---|-------|----------|--------|--------|
| **A1** | Confirmer la suppression d'une carte | §4 | trivial | nul |
| **A2** | Agrandir le rouage Settings | §5.1 | trivial | nul |
| **A3** | Settings passe sur `AppHeader` | §6.3 | trivial | nul |
| **A4** | Unifier la couleur de surlignage | §3.5 | trivial | nul |
| **E1** | **Feuilles : filtrer la cible du glissement** | §7.1 | trivial | nul |
| **E2** | **Feuilles : remettre `dragY` à 0 en fermant** | §7.2 | trivial | nul |
| **E3** | **Feuilles : stabiliser `onClose`** | §7.3 | trivial | nul |
| **B1** | Essayer `recent-unwrapped` | §3.1 | faible | **élevé** |
| **B2** | Bouton copier sur le miroir et les blocs de code | §6.4 | faible | faible |
| **B3** | Masquer le handle quand il n'y a qu'un pane | §1.2 | trivial | faible |
| **E4** | Feuilles : verrou du body + transform hors React | §7.4 | faible | faible |
| **E6a** | **Feuilles : une animation de fermeture** | §7.5a | faible | nul |
| **E7** | **Feuilles : dialog centré sur grand écran** | §7.6 | faible | faible |
| **G1** | **Le contexte sur l'écran pane et l'accueil** | §8.1 | faible | faible |
| **G2** | Aligner les champs des deux cartes | §8.3 | faible | nul |
| **C1** | Refonte du composer : une rangée au lieu de trois | §2 | moyen | moyen |
| **C2** | Tableaux dans le parseur Markdown | §3.2 | moyen | faible |
| **C3** | Réparer la hiérarchie de titres | §5.2 | faible | nul |
| **C4** | `errorElement` par route | §6.5 | faible | faible |
| **F1** | **Board en colonnes sur grand écran** | desktop | moyen | faible |
| **F2** | Élargir les autres écrans au-delà de 640 px | desktop | moyen | moyen |
| **G3** | Calculer le contexte pour tout pane, pas seulement ceux d'une carte | §8.2 | moyen | faible |
| **D1** | **Vue « Lecture » live sur le transcript** | §3.1, §3.2, §3.3 | **élevé** | moyen |
| **D2** | Trancher le mode clair | §6.1 | faible | faible |
| **E6b–d** | Feuilles : vélocité, seuil proportionnel, élasticité | §7.5b-e | moyen | faible |
| **E5** | *ou* adopter Vaul à la place de la feuille maison | §7.5, §7.7 | moyen | moyen |

---

## A — À faire sans discuter (quelques lignes chacune)

### A1. Confirmer la suppression d'une carte

Le patron existe déjà dans le fichier, deux `<Section>` plus haut : `usePendingConfirm` /
l'état `confirmRework` (`card.tsx:71`, `:279-305`), qui arme un second tap et explique ce qui va se
passer. Il suffit de l'appliquer au bouton Delete — le libellé du second tap devient
« Supprimer définitivement ? ».

Ce n'est pas une question de goût : c'est le seul geste irréversible de l'app, et c'est le seul non
protégé. Le hook `usePendingConfirm` a même déjà l'auto-désarmement à 3 s.

### A2. Agrandir le rouage Settings

`app-header.tsx:118-127` : passer le bouton en `flex size-9 items-center justify-center rounded-lg`
et garder l'icône en `size-5`. On passe de 20 px à 36 px de cible sans changer un pixel de ce qui
est dessiné. C'est le même traitement que le bouton History voisin (`agent-chat.tsx:536`).

### A3. Settings monte `AppHeader`

Remplacer le `<header>` de `settings.tsx:57-69` par `<AppHeader bridge={root?.bridge}
error={root?.error} onHome={…}>`. Le `root` est déjà lu dans le composant (`settings.tsx:30`), donc
les props sont disponibles. Bénéfice direct : sur l'écran de diagnostic de connexion, on voit enfin
l'état de la connexion.

### A4. Un seul jaune de recherche

Aligner `ansi-output.tsx:257` sur la paire `amber` du transcript, ou l'inverse. Mieux : en faire
deux tokens (`--find-hit`, `--find-hit-current`) dans `index.css`, puisque le sujet des tokens
revient en §6.2 et §D2.

---

## B — Peu de code, à évaluer avant de trancher

### B1. `recent-unwrapped` — la piste la plus courte, et la plus piégeuse

Un mot à changer dans `bridge/server.ts:430`, et herdr renvoie la sortie **sans les coupes du
terminal**. Le double wrap du §3.1 disparaît : le CSS `pre-wrap` du miroir devient alors la *seule*
coupe, à la largeur réelle du téléphone. C'est exactement ce que demande la carte.

**Pourquoi ce n'est pas un simple remplacement.** Tout le sous-système `lib/harness/claude/` — la
détection des menus de prompt, des wizards, des dialogues de prévisualisation, du multi-select, et
le `stripChrome` qui retire la boîte d'input de Claude du miroir — **reconnaît des boîtes dessinées
en box-drawing**, dont la géométrie dépend de lignes de largeur fixe. Dé-wrapper peut :

- casser la détection des dialogues → plus de boutons natifs, retour au pilotage clavier ;
- casser `extractStatusLine` et `extractInputDraft` (`agent-chat.tsx:164-207`) → la statusline
  disparaît, et le brouillon échoué du §9 cesse d'être détecté ;
- déclencher le `dialogPresent` à tort ou à travers, ce qui **bloque les envois** (`composer.tsx:287`).

**Comment l'évaluer sans risque** : ajouter `recent-unwrapped` comme *source alternative* derrière
la bascule « Raw terminal » qui existe déjà (`use-display-prefs.ts:14-19`) — cette bascule désactive
déjà toutes les grammaires Claude, donc dans ce mode il n'y a rien à casser. On obtient un mode
« prose lisible, sans boutons natifs » testable en une session réelle, et la décision se prend sur
des faits.

Le vrai correctif complet, lui, est en D1.

### B2. Copier

Deux gestes, deux endroits :

- **blocs de code du transcript** (`markdown-text.tsx:100-106`) : un petit bouton copier dans
  l'angle du `<pre>`. Le contenu est déjà une chaîne dans l'AST, donc c'est `navigator.clipboard
  .writeText(block.text)` et un ✓ éphémère. Le patron visuel existe dans `update-banner.tsx`.
- **miroir terminal** : un bouton dans la rangée View qui copie le buffer affiché. La chaîne est
  déjà là (`display` dans `agent-chat.tsx:154`).

`navigator.clipboard` exige un contexte sécurisé — comme le PWA et le push, déjà (`push.ts`). Sur
HTTP simple il faut donc désactiver le bouton plutôt que l'afficher mort ; le code de `push.ts` a
déjà le patron de détection.

### B3. Le handle qui ne sert à rien

`agent-chat.tsx:721` : passer la condition de `> 0` à `> 1`. 34 px rendus au miroir sur tous les
panes solitaires, et une affordance en moins qui ne menait nulle part.

---

## C — Chantiers moyens

### C1. Refonte du composer — « une rangée au lieu de trois »

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

### C2. Les tableaux Markdown

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

### C3. Hiérarchie de titres

Un `<h1>` visuellement discret (ou `sr-only`) par écran : « Herd » sur la home, « Board » sur le
board, le nom du pane sur le pane, « History » sur l'historique. Les `<h2>`/`<h3>` existants
deviennent alors cohérents. Une ligne par route.

### C4. Une barrière d'erreur par route

Ajouter `errorElement` sur `pane/:paneId`, `card/:cardId`, `board`, `pane/:paneId/history`
(`router.tsx:38-56`). Le composant `RootError` est réutilisable tel quel ; il faut juste que son
bouton renvoie vers le parent (le board, l'accueil) au lieu de recharger toute l'app. Un pane cassé
ne doit pas emporter le board.

---

## D — Les deux vraies décisions

### D1. Une vue « Lecture » live — la réponse de fond au problème du texte

C'est la piste qui résout **simultanément** les trois griefs de la carte sur le texte : le double
wrap, les tableaux, et « une interface qui réécrit le markdown proprement ».

**L'idée** : le miroir terminal et le transcript ne sont pas deux écrans, ce sont **deux modes du
même écran**. Une bascule dans le header du pane :

```
[ Terminal ]  [ Lecture ]
```

- **Terminal** — le miroir actuel, inchangé. Fidèle au TUI, avec ses boutons natifs, ses grammaires
  de dialogue, son alignement de colonnes. C'est le mode pour *piloter*.
- **Lecture** — les derniers tours du transcript rendus par `MarkdownText`, avec le composer normal
  en dessous. C'est le mode pour *lire ce que l'agent a écrit*.

Pourquoi c'est la bonne réponse plutôt qu'un rafistolage du wrap : le transcript n'a **jamais été
coupé**. Le markdown y est tel que Claude l'a produit, à la source. Il n'y a pas de dé-wrap à
deviner, pas d'heuristique de recollage, pas de largeur de pane à connaître (§3.4). Le texte
reflue à la largeur du téléphone parce qu'il n'a jamais eu d'autre largeur.

**Ce que ça demande, honnêtement :**

1. **Un transcript incrémental côté bridge.** `pageEntries` ne pagine qu'en arrière (`before`,
   `bridge/transcript.ts:358-371`). Il faut un `after` (ou un `since`) pour ne tirer que les tours
   nouveaux à chaque poll. C'est symétrique de ce qui existe, et le fichier JSONL est déjà lu ligne
   à ligne.
2. **Une revalidation ciblée.** Le `shouldRevalidate: () => false` actuel (`router.tsx:53`) est
   correct pour l'archive complète ; le mode Lecture aurait besoin d'un loader distinct qui ne
   demande que la queue (les *N* derniers tours), léger à tirer toutes les 1,5 s.
3. **La bascule et son état**, à ranger avec les autres préférences d'affichage
   (`use-display-prefs.ts`), donc persistée par appareil.
4. **Les dialogues restent au Terminal.** Un menu de prompt Claude n'existe **que** dans le TUI —
   le transcript ne le contient pas. Le mode Lecture doit donc soit basculer automatiquement vers
   Terminal quand `dialogPresent` devient vrai (le signal existe déjà, `agent-chat.tsx:191-199`),
   soit afficher un bandeau « une question attend — passer au terminal ». **Ne pas traiter ce
   point, c'est livrer un mode où l'agent peut se bloquer sans qu'on le voie.**

Ce n'est pas un petit chantier. Mais c'est le seul qui traite la cause plutôt que les symptômes, il
réutilise du code déjà écrit et testé (`MarkdownText`, `TranscriptView`, le parseur), et il
laisse le miroir terminal intact pour ce qu'il fait bien.

**Note sur la contrainte du fork** (`CLAUDE.md`, *The board*) : la surface upstream touchée serait
`bridge/transcript.ts` (ajout d'un `after`) et `router.tsx`. Le reste vit dans de nouveaux fichiers.
Le `after` sur le transcript est par ailleurs générique — il marche sans qu'aucune carte soit en
vue — donc c'est un candidat pour `UPSTREAM_PRS.md`.

### D2. Trancher sur le mode clair

Trois issues, à choisir explicitement plutôt qu'à laisser pourrir :

1. **Assumer le sombre** : supprimer les tokens `:root` clairs de `index.css:6-32` et les variantes
   `dark:` orphelines. Le fichier de tokens redevient une description honnête de la réalité.
   C'est le choix ponytail, et probablement le bon pour une app de chevet.
2. **Suivre le système** : retirer `class="dark"` de `index.html:2`, poser la classe au boot depuis
   `prefers-color-scheme`. Il faut alors auditer les contrastes en clair, corriger les `bg-zinc-800`
   du §6.2, et vérifier le miroir ANSI — dont les couleurs viennent du terminal et sont pensées pour
   un fond sombre. **C'est plus de travail qu'il n'y paraît**, précisément à cause du miroir.
3. **Un réglage explicite** dans Settings (clair / sombre / système). Même coût que (2), plus l'UI.

L'important est que ce soit décidé. En l'état, la moitié du système de couleurs est du code mort
qui ment sur ses intentions.

---

## E — Les feuilles

### E1–E3. Les trois corrections qui règlent les symptômes signalés

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

### E4. Les deux points mineurs

Verrouiller le défilement du document à l'ouverture (`document.body.style.overflow = "hidden"` dans
l'effet, restauré au cleanup — quatre lignes), et écrire le `transform` directement sur
`panelRef.current.style` pendant le glissement au lieu de passer par `setDragY`. Le second supprime
un rendu React par frame sur un panneau qui contient parfois un formulaire entier.

### E6. La physique du mouvement

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

### E7. La présentation desktop des feuilles

**Pas un autre composant : la même feuille, deux présentations.** Le conteneur actuel est déjà un
`fixed inset-0 flex flex-col justify-end` avec un panneau dedans (`sheet.tsx:113-145`). Le passage au
dialog centré est une affaire de classes :

```
mobile   : justify-end   + w-full   rounded-t-2xl  max-h-[82dvh]
≥ sm     : items-center  + max-w-lg mx-auto rounded-2xl max-h-[85dvh]
```

Plus trois ajustements : désactiver l'effet tactile au-dessus du point de rupture (le glissement n'a
pas de sens au pointeur), masquer la poignée en `sm:hidden`, et remplacer `slide-in-from-bottom` par
un `zoom-in` sur grand écran. **~12 lignes, aucun nouveau composant, aucune dépendance**, et les cinq
sites d'appel ne bougent pas.

Ce que ça ne couvre pas, et qui relève d'un travail ultérieur : la palette de commandes voudrait être
ancrée en haut (idiome ⌘K), et les feuilles d'action tab/pane voudraient être des popovers ancrés à
l'élément long-pressé plutôt que des modales. Les deux sont du raffinement, pas le premier pas.

À noter : **cette piste est indépendante de E5.** Vaul ne fournit pas de dialog centré (son
`direction` ne connaît que les quatre bords), donc le travail desktop est le même que l'on garde la
feuille maison ou non.

### E5. Vaul — la recommandation, révisée

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

**Recommandation en deux temps, à assumer comme telle :**

1. **E1–E3 maintenant, quoi qu'il arrive.** Ce sont des bugs, pas des préférences ; ils cassent la
   saisie dans la feuille de dictée. ~30 lignes, plus les deux tests tactiles manquants. À faire même
   si Vaul est adopté ensuite — parce que « ensuite » peut prendre des mois, et la feuille New card
   est cassée aujourd'hui.
2. **Puis trancher sur la physique.** E6 (~30 lignes à régler à tâtons, résultat incertain) contre
   E5 (deux dépendances, un ADR, résultat éprouvé). Mon avis : si la qualité du geste est un objectif
   — et la demande dit que oui — **Vaul se défend**, parce que c'est le seul lot où l'écriture maison
   perd structurellement. Si le geste doit seulement cesser d'être cassé, E1–E3 suffisent et le reste
   peut attendre.

Ce qui ne se défend pas, c'est l'ordre inverse : adopter Vaul pour contourner trois bugs de trente
lignes, sans avoir décidé qu'on veut sa physique.

---

## F — Le mode desktop, et le vrai Kanban

Le verrou est mécanique : `max-w-screen-sm` (640 px) sur le conteneur racine de **chaque** route —
`home.tsx:46`, `board.tsx:57`, `card.tsx:140`, `space.tsx:70`, `settings.tsx:56` — plus les overlays
de statut qui répètent la contrainte (`home.tsx:114`, `board.tsx:110`, `card.tsx:381`,
`space.tsx:133`). Sur un écran de 27 pouces, l'app occupe donc une colonne centrale de 640 px.

### F1. Le board en colonnes au-delà de `lg`

C'est la partie qui a le meilleur rapport valeur/effort, et l'argument anti-Kanban du code ne s'y
applique pas. `board.tsx:14-22` refuse le Kanban horizontal **parce qu'un téléphone n'a qu'une
colonne de large** — le raisonnement est juste, et il ne dit rien du desktop.

**La difficulté réelle : il y a huit colonnes.** `BOARD_COLUMNS` (`lib/board.ts:130-139`) :
`blocked · review · working · starting · orphaned · ready · backlog · done`. Huit colonnes à 280 px
font 2 240 px — au-delà de la plupart des écrans, donc on retomberait sur le panoramique horizontal
que le projet refuse, juste avec une souris.

La proposition est donc de **regrouper pour le desktop**, pas de transposer :

```
┌────────────┬────────────┬────────────┬────────────┐
│ Needs you  │ In progress│  Ready     │  Done      │
│            │            │            │            │
│ blocked    │ working    │ ready      │ done       │
│ review     │ starting   │ backlog    │            │
│ orphaned   │            │            │            │
└────────────┴────────────┴────────────┴────────────┘
```

Quatre colonnes = le cycle de vie réel d'une tâche, et chaque colonne reste lisible à 320 px. Les
sous-statuts restent visibles via le `CardStatusChip` déjà présent sur chaque tuile
(`card-tile.tsx:80`), donc aucune information n'est perdue.

Mise en œuvre : le regroupement est une constante de plus à côté de `BOARD_COLUMNS`, et le rendu
devient `grid-cols-1 lg:grid-cols-4` sur la liste de sections existante. **`CardTile` ne change
pas.** Le corps de `BoardRoute` bouge peu — il itère déjà sur des colonnes.

**Le glisser-déposer n'est pas requis pour la première version**, et le code explique pourquoi :
les cartes se déplacent toutes seules, réconciliées contre le troupeau à chaque poll
(`board.tsx:19-21`). Seules quatre colonnes sont manuelles (`MANUAL_STATUSES`, `card.tsx:61`), et la
page carte offre déjà les boutons « Move to ». Le drag serait un confort desktop, à ajouter après —
et il implique alors une bibliothèque ou du HTML5 drag-and-drop à la main, donc son propre
arbitrage.

### F2. Le reste des écrans

Plus délicat, et à faire **après** F1 :

- **L'accueil et la vue espace** gagneraient une grille à deux ou trois colonnes de cartes agent au
  lieu d'une liste étirée — `AgentCard` est déjà une tuile autonome, donc c'est surtout un conteneur
  à changer.
- **L'écran pane est le cas difficile.** Tout son dimensionnement suppose le mobile : le miroir se
  replie sur `wrapDefaultFor(viewportWidth)` qui bascule justement à 640 px
  (`use-display-prefs.ts:33` — donc le no-wrap desktop est **déjà** prévu et fonctionne), mais le
  composer, les bandes de navigation et la feuille de bascule de pane sont pensés pour le pouce. Un
  desktop honnête voudrait ici une disposition en deux volets (liste de panes à gauche, miroir à
  droite) — c'est un chantier à part entière, pas un `md:` à ajouter.
- **La page carte** s'y prête bien : deux colonnes (durable à gauche : spec, acceptance, journal ;
  live à droite : pane, contexte, prompt, handoff). Le découpage en `<Section>` existe déjà.

Ordre suggéré : **F1 seul d'abord**. C'est là que le grand écran apporte quelque chose qu'un
téléphone ne peut structurellement pas donner — voir tout le board d'un coup — et c'est le
changement le plus contenu.

---

## G — Faire dire la même chose aux deux vues

### G1. Le contexte là où la décision se prend

Deux ajouts, aucune nouvelle donnée à calculer pour le premier :

- **Écran pane** : monter `<ContextGauge>` au-dessus du composer, à côté de la statusline
  (`agent-chat.tsx:736`). Le composant existe, il gère déjà l'absence de chiffre en ne rendant rien
  (`context-gauge.tsx:12`), donc c'est sans risque. Il faut que le pane sache s'il est adossé à une
  carte — l'API board le sait déjà, le pane non ; le plus simple est d'ajouter `ctxPct` /
  `ctxTokens` à `AgentView` (voir G3, qui rend le chiffre disponible pour tous).
- **Accueil** : le pourcentage en texte sur `AgentCard`, comme `CardTile` le fait déjà
  (`card-tile.tsx:69`) — une ligne, une fois la donnée disponible.

### G2. Aligner les champs des deux tuiles

Décider ce qu'une tuile d'agent montre, et l'appliquer aux deux. Proposition : **branche + cwd
raccourci + ctx%** partout, l'espace en plus sur l'accueil (où l'on trie par espace) et le nombre de
sessions en plus sur le board (où il raconte l'historique de la tâche). L'essentiel est que les
champs communs ne soient plus présents d'un côté et absents de l'autre sans raison.

Note : `paneDisplayName()` (`types.ts:45`) est déjà l'arbitre du nom d'un pane. Une tuile de board
adossée à un pane vivant gagnerait à montrer les deux — titre de carte **et** nom de pane — puisque
c'est précisément le lien tâche ↔ agent que le board existe pour établir.

### G3. Calculer le contexte pour tout pane

C'est le correctif de fond, et il est côté bridge. `ContextTracker.update()` itère sur
`db.listOpenSessions()` (`context.ts:84`) — donc uniquement les panes nés d'une carte. Le faire
itérer sur **les panes du snapshot** (`snap.agents`) rendrait le chiffre disponible partout, y
compris pour un pane lancé à la main.

Le coût est réel et doit être regardé en face : une lecture de transcript par pane vivant toutes les
30 s (`REFRESH_MS`), là où aujourd'hui seuls les panes adossés à une carte sont lus. Sur un troupeau
de dix agents dont deux ont une carte, c'est cinq fois plus de lectures de fichiers. Les garde-fous
existent déjà — le throttle par pane, l'ignorance des agents sans transcript lisible
(`context.ts:87`), et le fait que tout échec dégrade silencieusement au « niveau 3 ». Reste que la
règle du dépôt est explicite (*« si c'est coûteux, throttle-le dans le consommateur »*, `CLAUDE.md`),
donc la cadence mériterait d'être mesurée avant d'être élargie.

Un intermédiaire moins coûteux : ne calculer que pour le pane **actuellement ouvert** plus ceux
adossés à une carte. Ça couvre le besoin réel — on regarde le contexte de l'agent qu'on est en train
de piloter — sans multiplier les lectures.

Le stockage bougerait aussi : `ctxPct` vit aujourd'hui dans `card_session` (`context.ts:107`), une
table durable. Pour un pane sans carte, c'est de l'état runtime — et la règle du fork est
explicite : *« `card` durable, `session` éphémère. Ne jamais persister d'état runtime »*
(`CLAUDE.md`). Le chiffre devrait donc vivre en mémoire dans le tracker et être servi avec le
snapshot, pas écrit en base.

---

## Ce que l'audit ne recommande pas

Pour fermer des portes que quelqu'un rouvrira :

- **Un Kanban horizontal sur mobile.** `board.tsx:14-22` explique pourquoi : un téléphone a une
  colonne de large, et le panoramique horizontal pour trouver la carte qui vous attend est exactement
  l'interaction que ce projet existe pour éviter. Ce raisonnement vaut pour le mobile — sur grand
  écran il ne s'applique pas, d'où F1.
- **Transposer les huit colonnes telles quelles sur desktop.** 8 × 280 px = 2 240 px, donc on
  retomberait sur le panoramique horizontal avec une souris. Le regroupement en quatre (F1) est la
  condition pour que le Kanban desktop ait un sens.
- **Réintroduire TanStack Query.** `CLAUDE.md` l'interdit et la couche loaders/revalidator fait le
  travail. Rien dans cet audit n'appelle une autre couche de données.
- **Une bibliothèque Markdown externe.** Elle produirait du HTML, et détruirait la frontière XSS qui
  est le pilier de la posture de sécurité du dépôt (`transcript-view.tsx:15-18`). Les tableaux (C2)
  s'ajoutent au parseur maison.
- **Vaul avant d'avoir essayé E1–E3.** Deux dépendances pour contourner trois bugs de vingt lignes.
  L'arbitrage redevient légitime si le geste reste mauvais après correction — avec un ADR, puisque
  c'est un choix architectural posé explicitement.
- **Le glisser-déposer sur le board, en première version.** Les cartes se déplacent seules
  (`board.tsx:19-21`), quatre statuts seulement sont manuels, et la page carte a déjà « Move to ».
  C'est un confort desktop à ajouter après F1, avec son propre arbitrage de dépendance.

---

## Par où commencer

**Aujourd'hui, quelques lignes chacune, aucun risque** — c'est le lot qui rend l'app nettement plus
agréable pour le moins de travail :

1. **A1** — confirmer la suppression d'une carte. C'est de la perte de données, aujourd'hui, en un tap.
2. **E1 + E2 + E3 + E6a** — les trois bugs de drawer, **plus l'animation de fermeture**. Les trois
   premiers règlent la fermeture pendant la saisie et le scintillement ; le quatrième supprime la
   disparition instantanée, qui est la plus grosse part de la sensation de brutalité. ~45 lignes dans
   un seul fichier, avec les deux tests tactiles qui manquent pour qu'ils ne reviennent pas.
3. **A2 + A3** — le rouage à 20 px, et Settings qui ne montre pas l'état de la connexion.

**Ensuite, les vrais gains :**

4. **C1** — la refonte du composer : +30 % de largeur d'input, deux lignes de terminal rendues,
   toutes les cibles au standard. C'est la demande explicite de la carte.
5. **G1** — le contexte sur l'écran pane. C'est là qu'on décide de passer la main, et c'est le seul
   écran où le chiffre n'est pas affiché.
6. **B2** — pouvoir copier. Sur un outil qui sert à récupérer ce qu'un agent produit, c'est une
   lacune de fond.

**Les deux chantiers, à décider explicitement :**

7. **F1 + E7** — le board en quatre colonnes sur grand écran, et les feuilles en dialog centré.
   Le seul endroit où le desktop apporte ce qu'un téléphone ne peut pas donner : tout voir d'un coup.
9. **E6b–d ou E5** — la physique du geste, ou Vaul. C'est la seule décision de dépendance de tout ce
   document ; elle mérite un ADR quel que soit le choix.
8. **D1** — la vue Lecture. C'est la seule réponse complète au problème du texte, et 60 % du code
   existe déjà — il est juste enterré derrière une icône et figé.
