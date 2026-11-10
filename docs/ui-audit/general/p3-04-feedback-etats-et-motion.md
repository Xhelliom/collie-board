# 4. Feedback, états et motion

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## Ce qui est bien fait

- **59 usages de `active:`** contre 22 de `hover:` — l'app privilégie correctement le retour tactile
  (`active:scale-[0.98]` sur les boutons, `active:bg-muted/60` sur les rangées) plutôt que le survol,
  qui n'existe pas au doigt. C'est le bon réflexe mobile, et rare.
- **La barre d'activité** (`.busy-bar`, `index.css:160`) est un vrai morceau de finition : elle
  attend 120 ms avant de devenir visible, donc une action rapide ne produit aucun flash. Ce genre de
  détail est ce qui sépare une interface soignée d'une interface qui clignote.
- **11 usages de `tabular-nums`** — les chiffres qui ne dansent pas quand un compteur change. C'est
  un détail de professionnel.
- **`prefers-reduced-motion` respecté en 5 endroits**, jusque dans le CSS inline du splash.
- **112 attributs `aria-*`** : la sémantique d'accessibilité est prise au sérieux (les trous relevés
  en §5 sont des exceptions, pas une tendance).

## Ce qui manque

- **Aucun retour haptique.** Zéro `navigator.vibrate`. Sur une application dont plusieurs actions
  passent par une confirmation à deux taps, un pulse de 10 ms au moment où le bouton s'arme est
  exactement le bon usage — c'est le signal qui dit « j'ai compris, confirme ». Réserve honnête :
  l'API n'existe pas sur iOS Safari, donc le gain est Android-only.
- **Le mouvement est générique.** Le point a été traité en détail pour le drawer (§7.5), mais il se
  généralise : `transition-colors`, `transition-transform`, `duration-200`, et **pas une seule classe
  `ease-*` dans tout `components/`**. Toutes les animations de l'app tournent sur les courbes par
  défaut. Un système de motion, c'est deux ou trois courbes nommées et deux durées — c'est peu de
  travail et ça change la perception d'un produit.
- **Zéro skeleton, 37 spinners.** Nuance importante : ce n'est *pas* forcément un défaut ici. L'app
  polle et revalide, donc les données sont généralement déjà à l'écran ; le seul vrai chargement à
  froid est le splash de démarrage, qui est soigné. Le spinner est légitime pour une action, moins
  pour du contenu — mais l'app a peu de cas de « contenu qui arrive vide ».

---
