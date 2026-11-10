# 2. Typographie — aucune échelle n'a été décidée

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

**245 déclarations de taille de texte**, réparties ainsi :

| Taille | Occurrences | Part |
|---|---|---|
| `text-xs` (12 px) | 103 | 42 % |
| `text-sm` (14 px) | 84 | 34 % |
| **`text-[11px]`** | **32** | 13 % |
| **`text-[10px]`** | **15** | 6 % |
| `text-base` (16 px) | 5 | 2 % |
| `text-lg` (18 px) | 4 | 2 % |
| `text-[13px]`, `text-[0.95rem]` | 2 | — |

Deux lectures, toutes deux préoccupantes :

**a) 76 % de l'interface est en 12 px ou moins.** Sur un téléphone. Pour référence : iOS HIG place le
corps de texte à 17 pt et réserve le 11 pt aux légendes ; Material Design donne 14 sp comme plancher
de corps de texte et 16 sp comme valeur recommandée. Ici, le corps de texte *est* la légende. Le
`text-base` (16 px), c'est-à-dire la taille de lecture confortable, apparaît **cinq fois** — et
essentiellement sur les champs de saisie, où il est obligatoire pour éviter le zoom automatique
d'iOS.

L'app est donc **très dense**, ce qui n'est pas illégitime pour un outil technique — mais c'est un
choix qui n'a jamais été fait consciemment, il découle de l'absence d'échelle.

**b) 19 % des tailles sont des valeurs arbitraires** (`text-[10px]`, `text-[11px]`, `text-[13px]`,
`text-[0.95rem]`). Une fois sur cinq, l'échelle Tailwind est contournée. C'est la signature d'une
typographie ajustée au cas par cas, à l'œil, sans système : quand on a besoin de « un peu plus petit
que `text-xs` », on écrit `text-[11px]` — et la fois d'après on écrit `text-[10px]`.

## Aucune police n'a été choisie

- **`--font-sans` n'est pas défini du tout.** L'interface tourne donc sur la pile Tailwind par
  défaut (`ui-sans-serif, system-ui, …`), c'est-à-dire San Francisco sur iOS et Roboto sur Android.
  Défendable (les polices système sont excellentes et gratuites en poids), mais c'est un défaut, pas
  une décision.
- **`--font-mono` déclare `"JetBrains Mono"` en tête** (`index.css:96`) — et elle **n'est jamais
  chargée** : zéro `@font-face`, zéro preload, aucun `.woff` dans `public/`. Le navigateur ne la
  trouve donc que si l'utilisateur l'a installée sur son téléphone, ce qui n'arrive jamais. En
  pratique on tombe silencieusement sur le fallback : Roboto Mono sur Android, SF Mono ou Menlo sur
  iOS.

Conséquence concrète : **le miroir terminal — l'élément central de cette application — n'a pas la
même police selon l'appareil**, avec des chasses et des hauteurs d'x différentes. Sur une app dont
tout le contenu est du texte à chasse fixe, c'est le détail typographique qui compte le plus, et
c'est celui qui est laissé au hasard.

---
