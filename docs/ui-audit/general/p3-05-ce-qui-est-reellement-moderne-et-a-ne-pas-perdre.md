# 5. Ce qui est réellement moderne — et à ne pas perdre de vue

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

La revue serait injuste sans ceci. Le socle CSS est **à jour**, ce qui est loin d'être universel :

| Technique | Usages | Commentaire |
|---|---|---|
| `oklch()` pour toute la palette | 44 | espace perceptuellement uniforme — la bonne pratique 2024+ |
| `dvh` plutôt que `vh` | 7 | corrige le bug de la barre d'URL mobile |
| `env(safe-area-inset-*)` | 15 | encoches et indicateur home gérés partout |
| `field-sizing: content` | 1 | textarea auto-extensible **sans JavaScript** — CSS très récent |
| `:has()` (`has-[>svg]:px-3`) | 3 | sélecteur parent, longtemps impossible |
| `color-mix()` | 1 | mélange de couleurs en CSS natif |
| Tailwind v4 avec `@theme inline` | — | la génération actuelle, pas la précédente |
| PWA complète | — | manifeste, service worker, splash, icônes maskable |

Un socle de 2026, donc. C'est bien ce qui rend l'absence de décisions de design frappante : **les
outils modernes sont là, ils ne sont simplement pas utilisés pour faire des choix**.

## Ce qui manque du CSS d'aujourd'hui

- **`text-wrap: pretty` / `balance`** : zéro usage. Une ligne de CSS globale (`p { text-wrap: pretty }`)
  supprime les orphelines dans tous les paragraphes ; `text-balance` sur les titres équilibre les
  retours à la ligne. C'est le meilleur rapport qualité/effort de toute cette partie.
- **Container queries** : zéro. Voir §1 — c'est l'outil du board desktop.
- **`scroll-snap`** : zéro, alors que l'app a **trois** bandes de défilement horizontal (TabStrip,
  PaneStrip, SpaceStrip). Un `snap-x snap-mandatory` ferait s'aligner les pastilles au lieu de les
  laisser à moitié coupées au bord — la finition qui distingue un carrousel natif d'un `overflow-x: auto`.
- **`@starting-style`** : zéro. Permettrait des animations d'entrée sans classe ni JavaScript.

---
