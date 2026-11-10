# 7. Cinq gestes qui changeraient le ressenti

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

Classés par (impact perçu ÷ effort). Aucun ne touche au comportement, donc aucun ne peut casser une
des mécaniques du §9.

## R1. Teinter les neutres — 20 valeurs, une heure, transforme tout

Passer les 18 tokens gris de `oklch(L 0 0)` à `oklch(L 0.006 250)` (froid, technique — cohérent avec
un outil de terminal) ou `oklch(L 0.008 80)` (chaud, plus proche de la mascotte). C'est **le
changement au plus fort rapport impact/effort de tout ce document** : personne ne le remarque
consciemment, tout le monde trouve que « ça a l'air mieux fait ».

À faire en même temps que la décision sur le mode clair (§D2), puisque c'est le même fichier.

## R2. Décider une échelle typographique — et remonter le corps de texte

Trois gestes :

1. **Supprimer les 47 valeurs arbitraires** (`text-[10px]`, `text-[11px]`, `text-[13px]`,
   `text-[0.95rem]`) en les repliant sur l'échelle. Si un cran manque, l'ajouter au thème une fois,
   pas au cas par cas.
2. **Remonter d'un cran ce qui est du contenu** : le nom d'un agent, le titre d'une carte, le corps
   d'un message ne sont pas des légendes. Les `text-xs` qui portent de l'information deviennent
   `text-sm`, les `text-sm` de contenu principal deviennent `text-base`. Les métadonnées restent
   petites — c'est justement ce qui crée la hiérarchie qui manque aujourd'hui.
3. **Poser trois rôles** au lieu de sept tailles : titre / corps / métadonnée. Le reste découle.

Attention : ce geste **consomme de la hauteur d'écran**, qui est déjà le problème du §1. À faire donc
**après** la refonte du composer (C1), qui en libère.

## R3. Charger une vraie police

Deux décisions distinctes :

- **Mono** : soit fournir réellement JetBrains Mono (une variable font en `woff2`, self-hostée,
  preloadée — la CSP stricte impose le self-hosting de toute façon), soit **retirer la mention** et
  assumer la pile système. L'état actuel — la déclarer sans la charger — est le pire des trois :
  il donne l'illusion d'une décision qui n'a aucun effet.
- **Sans** : définir `--font-sans` explicitement, même si c'est pour y mettre la pile système. Une
  décision écrite vaut mieux qu'un défaut hérité.

Le coût réel à peser : une variable font mono self-hostée, c'est ~30-60 ko en woff2 sur une PWA
servie par tailscale. Sur un réseau local, c'est négligeable ; c'est un choix, pas une évidence.

## R4. Deux ou trois courbes de motion nommées

Ajouter au thème : une courbe d'entrée (décélération), une de sortie (accélération), une durée
courte (150 ms) et une longue (250 ms). Puis remplacer les `duration-200` nus. C'est une quinzaine de
lignes dans `index.css` et un passage de recherche/remplacement — et c'est ce qui fait qu'une
interface « répond » au lieu de « changer d'état ».

Le drawer (§E6) est le cas le plus visible, mais tout en bénéficie.

## R5. Les finitions à une ligne

Toutes indépendantes, toutes triviales :

- `text-wrap: pretty` sur les paragraphes, `text-balance` sur les titres — une règle globale ;
- `snap-x snap-mandatory` + `snap-start` sur les trois bandes horizontales ;
- `navigator.vibrate(10)` sur l'armement des confirmations à deux taps (Android) ;
- retirer les 22 `hover:` — ou plutôt les **garder**, puisque le desktop arrive (F1/E7) : ils
  cesseront d'être du code mort.

---
