# 2. Le composer — les points signalés, mesurés

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## 2.1 La largeur d'input (« rognée à droite et à gauche »)

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

## 2.2 La taille des boutons (« les boutons sont petits »)

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

## 2.3 La rangée Controls est payée en permanence pour un usage épisodique

Keys / Quick / Agent (`composer.tsx:565-604`) occupent une rangée pleine 100 % du temps ; leur
contenu ne s'ouvre que sur tap. Trois boutons `flex-1` + un `SectionLabel` qui ne pilote rien
consomment 40 px en continu pour ce qui est fonctionnellement un menu.

Même remarque pour le `SectionLabel` « View » (`composer.tsx:475`) : il consomme de la largeur pour
étiqueter cinq icônes qui portent déjà chacune un `aria-label` et un `title`.

---
