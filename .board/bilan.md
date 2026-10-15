# Bilan — finish_card (serveur MCP)

## Fait
- `bridge/mcp.ts` : outil `finish_card(cardId, mode = "pr" | "merge" | "done")`, `readOnlyHint: false`,
  `destructiveHint: true` (comme `launch_lot`). `card_id` accepté aussi.
  - `pr` → `POST /api/cards/:id/integration {action:"pr", andDone}` : le bouton « Ouvrir / Mettre à jour la PR et terminer ».
  - `merge` → `{action:"merge", andDone}` : « Fusionner dans {base} et terminer », le merge direct dans main.
  - `done` → `PATCH /api/cards/:id {status:"done"}` : « Classer → Terminé », sans intégrer.
  - `andDone` = le `filing` des boutons (faux si la carte est déjà done/archived).
  - Résultat en une phrase ; refus rendus en clair selon `kind` (in-progress, conflict, refused, git/herdr), jamais de JSON brut.
- `bridge/mcp.test.ts` : tests unitaires (requêtes, annotations, refus) + bout en bout contre la vraie
  route `handleBoardRoute` et un vrai dépôt git : merge → main contient la branche et carte `done` ;
  pr (faux `gh` dans le PATH) → `card.pr_follow` journalisé, carte non classée ; conflit → refus en clair, carte intacte.
- README (liste des outils MCP), fragment `changes/board-serveur-mcp-ajouter-pr-et-termine-finish-card.md` (minor).

## Pas fait
- ADR 0039 non retouché (liste d'outils datée ; un ADR ne se réécrit pas).
- « Archiver » n'est pas un mode : c'est ranger une carte, pas la terminer.
- Pas testé en vrai depuis Loquivox (nécessite redémarrage du client MCP, pas du bridge : `mcp.ts` est lancé par le client).
