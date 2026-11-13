# 0060 — Un champ inconnu sur une carte est refusé, jamais ignoré ni pris pour un alias

**Status:** Accepted

## Context

`POST /api/cards` et `PATCH /api/cards/<id>` lisaient une liste de clés et laissaient tomber les autres
sans un mot. Un orchestrateur a envoyé le brief d'une carte sous `"description"` au lieu de `"spec"` : 200,
carte enregistrée avec `spec: null`, et chaque worker lancé dessus est parti avec son seul titre. Rien n'a
signalé l'erreur — l'appelant est un agent, il ne relit pas la carte.

Deux options reviendront : **ignorer** (tolérance, « robustness principle ») et **accepter des alias**
(`description`, `body`, `brief` → `spec`).

## Decision

**Toute clé que `parseCardBody` ne lit pas est un 400**, qui nomme la clé et, quand il y en a une, celle
qu'elle voulait probablement dire (`unknown field "description" — did you mean "spec"?`). La liste vit dans
`bridge/card-fields.ts`. Les champs dérivés (`origin`, `originCardId`, `createdBy` —
[ADR 0010](./0010-an-agent-filed-card-is-traced-on-the-card.md), [ADR 0048](./0048-board-partage-par-git-pair-a-pair-multi-utilisateur.md) §5)
sont refusés de même, avec « derived by the bridge » : un corps qui les prétend est refusé entier, plus
écrit sans eux.

**Pas d'alias.** La table `description → spec` ne sert qu'au message : un alias accepté, c'est deux
orthographes par champ, dans la doc, la skill, le MCP et chaque client, pour toujours.

Une création sans `spec` ni `rawInput` reste valide (conteneur, rappel) mais répond avec
`warnings: ["card has no spec: …"]` à côté de `ok` et `card`.

## Consequences

- Un client qui envoyait une clé en trop (une vue de carte renvoyée telle quelle) reçoit désormais un 400.
  Les clients du dépôt (web `CardInput`, outils MCP, skill) n'envoient que des clés connues.
- Ajouter un champ à `parseCardBody` sans l'ajouter à `CARD_BODY_FIELDS` le fait refuser :
  `bridge/card-fields.test.ts` passe chaque champ de la liste par le parseur et exige qu'il arrive.
- Les autres routes d'écriture (`/api/runs`, `/api/phases`, `/api/templates`, `/api/flows`…) ignorent
  encore les clés inconnues ; même règle à leur appliquer quand on y touche.
