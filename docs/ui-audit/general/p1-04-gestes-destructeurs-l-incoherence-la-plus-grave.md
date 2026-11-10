# 4. Gestes destructeurs — l'incohérence la plus grave de l'audit

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

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
