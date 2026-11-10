# Ce que l'audit ne recommande pas

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

Pour fermer des portes que quelqu'un rouvrira :

- **Un Kanban horizontal sur mobile.** `board.tsx:14-22` explique pourquoi : un téléphone a une
  colonne de large, et le panoramique horizontal pour trouver la carte qui vous attend est exactement
  l'interaction que ce projet existe pour éviter. Ce raisonnement vaut pour le mobile — sur grand
  écran il ne s'applique pas, d'où F1.
- **Transposer les huit colonnes telles quelles sur desktop.** 8 × 280 px = 2 240 px, donc on
  retomberait sur le panoramique horizontal avec une souris. Le regroupement en quatre (F1) est la
  condition pour que le Kanban desktop ait un sens.
- **Réintroduire TanStack Query.** `CLAUDE.md` l'interdit et la couche loaders/revalidator fait le
  travail. Rien dans cet audit n'appelle une autre couche de données.
- **Une bibliothèque Markdown externe.** Elle produirait du HTML, et détruirait la frontière XSS qui
  est le pilier de la posture de sécurité du dépôt (`transcript-view.tsx:15-18`). Les tableaux (C2)
  s'ajoutent au parseur maison.
- **Vaul avant d'avoir essayé E1–E3.** Deux dépendances pour contourner trois bugs de vingt lignes.
  L'arbitrage redevient légitime si le geste reste mauvais après correction — avec un ADR, puisque
  c'est un choix architectural posé explicitement.
- **Le glisser-déposer sur le board, en première version.** Les cartes se déplacent seules
  (`board.tsx:19-21`), quatre statuts seulement sont manuels, et la page carte a déjà « Move to ».
  C'est un confort desktop à ajouter après F1, avec son propre arbitrage de dépendance.

---
