# F — Le mode desktop, et le vrai Kanban

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

Le verrou est mécanique : `max-w-screen-sm` (640 px) sur le conteneur racine de **chaque** route —
`home.tsx:46`, `board.tsx:57`, `card.tsx:140`, `space.tsx:70`, `settings.tsx:56` — plus les overlays
de statut qui répètent la contrainte (`home.tsx:114`, `board.tsx:110`, `card.tsx:381`,
`space.tsx:133`). Sur un écran de 27 pouces, l'app occupe donc une colonne centrale de 640 px.

## F1. Le board en colonnes au-delà de `lg`

C'est la partie qui a le meilleur rapport valeur/effort, et l'argument anti-Kanban du code ne s'y
applique pas. `board.tsx:14-22` refuse le Kanban horizontal **parce qu'un téléphone n'a qu'une
colonne de large** — le raisonnement est juste, et il ne dit rien du desktop.

**La difficulté réelle : il y a huit colonnes.** `BOARD_COLUMNS` (`lib/board.ts:130-139`) :
`blocked · review · working · starting · orphaned · ready · backlog · done`. Huit colonnes à 280 px
font 2 240 px — au-delà de la plupart des écrans, donc on retomberait sur le panoramique horizontal
que le projet refuse, juste avec une souris.

La proposition est donc de **regrouper pour le desktop**, pas de transposer :

```
┌────────────┬────────────┬────────────┬────────────┐
│ Needs you  │ In progress│  Ready     │  Done      │
│            │            │            │            │
│ blocked    │ working    │ ready      │ done       │
│ review     │ starting   │ backlog    │            │
│ orphaned   │            │            │            │
└────────────┴────────────┴────────────┴────────────┘
```

Quatre colonnes = le cycle de vie réel d'une tâche, et chaque colonne reste lisible à 320 px. Les
sous-statuts restent visibles via le `CardStatusChip` déjà présent sur chaque tuile
(`card-tile.tsx:80`), donc aucune information n'est perdue.

Mise en œuvre : le regroupement est une constante de plus à côté de `BOARD_COLUMNS`, et le rendu
devient `grid-cols-1 lg:grid-cols-4` sur la liste de sections existante. **`CardTile` ne change
pas.** Le corps de `BoardRoute` bouge peu — il itère déjà sur des colonnes.

**Le glisser-déposer n'est pas requis pour la première version**, et le code explique pourquoi :
les cartes se déplacent toutes seules, réconciliées contre le troupeau à chaque poll
(`board.tsx:19-21`). Seules quatre colonnes sont manuelles (`MANUAL_STATUSES`, `card.tsx:61`), et la
page carte offre déjà les boutons « Move to ». Le drag serait un confort desktop, à ajouter après —
et il implique alors une bibliothèque ou du HTML5 drag-and-drop à la main, donc son propre
arbitrage.

## F2. Le reste des écrans

Plus délicat, et à faire **après** F1 :

- **L'accueil et la vue espace** gagneraient une grille à deux ou trois colonnes de cartes agent au
  lieu d'une liste étirée — `AgentCard` est déjà une tuile autonome, donc c'est surtout un conteneur
  à changer.
- **L'écran pane est le cas difficile.** Tout son dimensionnement suppose le mobile : le miroir se
  replie sur `wrapDefaultFor(viewportWidth)` qui bascule justement à 640 px
  (`use-display-prefs.ts:33` — donc le no-wrap desktop est **déjà** prévu et fonctionne), mais le
  composer, les bandes de navigation et la feuille de bascule de pane sont pensés pour le pouce. Un
  desktop honnête voudrait ici une disposition en deux volets (liste de panes à gauche, miroir à
  droite) — c'est un chantier à part entière, pas un `md:` à ajouter.
- **La page carte** s'y prête bien : deux colonnes (durable à gauche : spec, acceptance, journal ;
  live à droite : pane, contexte, prompt, handoff). Le découpage en `<Section>` existe déjà.

Ordre suggéré : **F1 seul d'abord**. C'est là que le grand écran apporte quelque chose qu'un
téléphone ne peut structurellement pas donner — voir tout le board d'un coup — et c'est le
changement le plus contenu.

---
