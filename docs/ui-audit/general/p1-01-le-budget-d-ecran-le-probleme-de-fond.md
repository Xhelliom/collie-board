# 1. Le budget d'écran : le problème de fond

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## 1.1 Onze bandes pour un contenu

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

## 1.2 Deux affordances pour le même geste

Changer de pane est offert **deux fois** sur le même écran :

- la `PaneStrip`, une bande d'onglets sous les tabs (`agent-chat.tsx:624-636`) ;
- le handle swipe-up + `BottomSheet` « Switch pane » (`agent-chat.tsx:721-731` et `:768-776`).

Elles font strictement le même travail. Le handle est monté dès qu'**un seul** pane existe
(condition `agents.length + shellPanes.length > 0`, jamais `> 1`), donc il coûte ses 34 px même
quand il n'y a rien vers quoi basculer.

---
