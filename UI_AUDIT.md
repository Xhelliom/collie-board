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

Les trois griefs signalés dans la carte sont réels, et l'audit en donne la mesure. Il relève en
plus **dix problèmes non signalés**, dont un de gravité supérieure à tous les autres : **la
suppression d'une carte se fait en un tap, sans confirmation**, dans une application où tous les
autres gestes destructeurs — bien moins graves — en demandent deux.

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

## 7. Ce qui est solide (et qu'il ne faut pas casser en corrigeant le reste)

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
casser une des mécaniques du §7.

| # | Piste | Répond à | Effort | Risque |
|---|-------|----------|--------|--------|
| **A1** | Confirmer la suppression d'une carte | §4 | trivial | nul |
| **A2** | Agrandir le rouage Settings | §5.1 | trivial | nul |
| **A3** | Settings passe sur `AppHeader` | §6.3 | trivial | nul |
| **A4** | Unifier la couleur de surlignage | §3.5 | trivial | nul |
| **B1** | Essayer `recent-unwrapped` | §3.1 | faible | **élevé** |
| **B2** | Bouton copier sur le miroir et les blocs de code | §6.4 | faible | faible |
| **B3** | Masquer le handle quand il n'y a qu'un pane | §1.2 | trivial | faible |
| **C1** | Refonte du composer : une rangée au lieu de trois | §2 | moyen | moyen |
| **C2** | Tableaux dans le parseur Markdown | §3.2 | moyen | faible |
| **C3** | Réparer la hiérarchie de titres | §5.2 | faible | nul |
| **C4** | `errorElement` par route | §6.5 | faible | faible |
| **D1** | **Vue « Lecture » live sur le transcript** | §3.1, §3.2, §3.3 | **élevé** | moyen |
| **D2** | Trancher le mode clair | §6.1 | faible | faible |

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
  disparaît, et le brouillon échoué du §7 cesse d'être détecté ;
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

À préserver impérativement (§7) : la garde à deux taps sur envoi destructeur, l'aperçu « You
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

## Ce que l'audit ne recommande pas

Pour fermer des portes que quelqu'un rouvrira :

- **Un Kanban horizontal sur le board.** `board.tsx:14-22` explique déjà pourquoi : un téléphone a
  une colonne de large, et le panoramique horizontal pour trouver la carte qui vous attend est
  exactement l'interaction que ce projet existe pour éviter. C'est un choix, pas un manque.
- **Réintroduire TanStack Query.** `CLAUDE.md` l'interdit et la couche loaders/revalidator fait le
  travail. Rien dans cet audit n'appelle une autre couche de données.
- **Une bibliothèque Markdown externe.** Elle produirait du HTML, et détruirait la frontière XSS qui
  est le pilier de la posture de sécurité du dépôt (`transcript-view.tsx:15-18`). Les tableaux (C2)
  s'ajoutent au parseur maison.
- **Un mode desktop et le comportement du drawer mobile** — hors périmètre, traités par leurs
  propres cartes. Note pour la carte desktop : le verrou est `max-w-screen-sm` (640 px) posé sur le
  conteneur racine de chaque route (`home.tsx:46`, `board.tsx:57`, `card.tsx:140`, `space.tsx:70`,
  `settings.tsx:56`) — cinq endroits, plus les overlays de statut qui le répètent.

---

## Les cinq choses à faire en premier

Si rien d'autre n'est fait :

1. **A1** — confirmer la suppression d'une carte. C'est de la perte de données, aujourd'hui, en un tap.
2. **C1** — la refonte du composer. C'est la demande explicite de la carte, et le gain est mesurable :
   +30 % de largeur d'input, deux lignes de terminal rendues, toutes les cibles au standard.
3. **A2 + A3** — le rouage à 20 px, et Settings qui ne montre pas l'état de la connexion.
4. **B2** — pouvoir copier. Sur un outil qui sert à récupérer ce qu'un agent produit, c'est une
   lacune de fond.
5. **D1** — la vue Lecture. C'est le chantier, mais c'est la seule réponse complète au problème du
   texte, et 60 % du code existe déjà.
