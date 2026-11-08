# 1. Responsive — le mot ne s'applique pas

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

**Deux occurrences de breakpoint dans toute l'application.** Les deux dans le même fichier :

```
components/card-diff.tsx:166   sm:min-w-max
components/card-diff.tsx:171   sm:whitespace-pre sm:break-normal
```

C'est tout. Pas un `md:`, pas un `lg:`, pas un `xl:` — nulle part ailleurs.

Ce que l'app fait à la place, c'est **contraindre** : `max-w-screen-sm` (640 px) sur les cinq
conteneurs de route. Une contrainte de largeur n'est pas du responsive — c'est une mise en boîte.
L'interface ne s'adapte pas au grand écran, elle s'y refuse.

Il y a une nuance de bonne foi à porter au crédit du projet : c'est une PWA mobile, assumée comme
telle, et sur ce périmètre les fondamentaux sont **bien** tenus (viewport avec `viewport-fit=cover`
et `interactive-widget=resizes-content`, `dvh` plutôt que `vh`, 15 usages de `env(safe-area-inset-*)`).
Ce n'est pas une app desktop mal portée sur mobile : c'est une app mobile qui n'a jamais envisagé
autre chose.

Mais la question posée est « est-ce que ça suit les bonnes pratiques d'une interface web
responsive » — et la réponse honnête est **non, parce qu'il n'y a pas de responsive du tout**.

**Le manque le plus moderne** : zéro *container query*, alors que Tailwind 4 les fournit
nativement et qu'elles sont exactement l'outil dont ce projet aura besoin. Un `CardTile` doit se
présenter différemment dans une colonne de Kanban à 320 px et en pleine largeur sur téléphone — et
c'est une propriété de **son conteneur**, pas du viewport. Faire ça en `md:` sur le viewport donnerait
le mauvais résultat dans la colonne étroite d'un grand écran. À poser en même temps que F1.

---
