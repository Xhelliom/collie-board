# 5. Accessibilité

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## 5.1 Le rouage Settings est sous le minimum absolu

`app-header.tsx:118-127` : un `<button>` **sans aucun padding**, dont le seul contenu est
`<Settings className="size-5" />`. La cible fait donc **20 × 20 px** — c'est **sous le minimum
WCAG 2.2 AA (24 × 24)**, pas seulement sous les guides plateformes. Elle est placée dans le coin
haut-droit, contre le bord de l'écran, sur trois écrans (home, board, space).

Les autres boutons du même header sont en `size-8` (`agent-chat.tsx:536`) : le rouage est une
exception, pas une convention.

## 5.2 Hiérarchie de titres cassée

Deux `<h1>` dans toute l'application : `routes/card.tsx:177` et `routes/settings.tsx:67`. Les
écrans principaux — **home, board, pane, historique, space** — n'en ont aucun. Pire, ils portent des
`<h2>` (`agent-list.tsx:50`, `space-overview.tsx:24`) et des `<h3>` (`space-view.tsx:36`,
`agent-sidebar.tsx:90`) **sans `<h1>` parent** : un lecteur d'écran qui navigue par titres tombe sur
une arborescence orpheline (WCAG 1.3.1).

## 5.3 Le statut d'erreur n'est pas atteignable au clavier

`status-area.tsx:29-49` : la bande de statut est un `<div role="status" aria-live="polite">` sur
lequel un `onClick` est posé quand le ton est `error`. Pas de `<button>`, pas de `tabIndex`, pas de
gestion de `Enter`/`Espace`, et la croix `<X>` n'a pas de label. C'est la **seule chose de
l'application qu'on doive activement écarter** (les autres tons s'effacent seuls), et c'est la seule
qui ne soit pas activable au clavier.

## 5.4 Ce qui est bien fait, pour être juste

`prefers-reduced-motion` est respecté **partout** (`index.css:145`, `:200`, et jusque dans le splash
inline de `index.html:52`). Les feuilles gèrent le focus à l'ouverture et le restaurent à la
fermeture (`sheet.tsx:11-21`). Les backdrops sont `aria-hidden` pour ne pas doubler le bouton de
fermeture (`sheet.tsx:129-131`). `aria-pressed` / `aria-expanded` sont posés correctement sur les
bascules du composer. Ce n'est pas une interface négligée sur ce plan — les quatre points ci-dessus
sont des trous, pas une tendance.

---
