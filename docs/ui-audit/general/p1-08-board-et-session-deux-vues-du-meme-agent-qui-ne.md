# 8. Board et session : deux vues du même agent qui ne disent pas la même chose

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

Un agent apparaît sous deux formes — `AgentCard` (accueil, vue espace) et `CardTile` (board) — et
elles n'affichent ni les mêmes champs, ni les mêmes champs disponibles.

| Information | `AgentCard` (accueil) | `CardTile` (board) | Page pane | Page carte |
|---|---|---|---|---|
| Statut de l'agent | ✅ | ✅ (si pane vivant) | ✅ | ✅ |
| Répertoire (`cwd`) | ✅ | ❌ | ✅ | ✅ |
| Branche git | ❌ | ✅ | ❌ | ✅ |
| Espace / workspace | ✅ | ❌ | ✅ (fil d'Ariane) | ❌ |
| Nombre de sessions | ❌ | ✅ | ❌ | ✅ |
| **Contexte utilisé (`ctx %`)** | **❌** | **✅** | **❌** | **✅ (jauge)** |

Sources : `agent-card.tsx:36-57`, `card-tile.tsx:57-71`, `agent-chat.tsx:569-581`, `card.tsx:196-198`.

## 8.1 Le contexte est l'exemple le plus net, et il est à l'envers

Le pourcentage de contexte est une propriété **de la session de l'agent** — pas de la tâche. Or il
n'est visible que sur les deux écrans « tâche » (board, carte), et **absent des deux écrans
« agent »** (accueil, pane).

C'est l'inverse de l'usage : on décide de passer la main (`handoff`) **quand on regarde l'agent
travailler**, pas quand on parcourt le board. Et l'écran pane est justement celui où la décision se
prend — il porte le composer, on y voit l'agent ramer.

Le seul substitut sur l'écran pane est la statusline brute de Claude, ré-affichée en texte monospace
(`agent-chat.tsx:736-740`) : elle contient parfois un `ctx%`, **si** Claude l'affiche, **si** la
grammaire l'extrait, et sans aucune mise en forme — pas la jauge colorée avec ses seuils à 70/85 %
qui existe pourtant (`context-gauge.tsx`).

## 8.2 La cause est dans le bridge, pas dans l'UI

`bridge/context.ts:84` :

```ts
const due = this.db.listOpenSessions().filter((s) => { … });
```

Le `ContextTracker` n'itère **que sur les sessions ouvertes en base**, c'est-à-dire les panes
démarrés **depuis une carte**. Conséquence en deux temps :

1. Un pane lancé à la main (nouvel onglet dans Collie, ou depuis herdr) **n'a jamais de contexte**,
   quelle que soit la vue. Ce n'est pas un problème d'affichage : le chiffre n'est jamais calculé.
2. Même pour un pane adossé à une carte, le chiffre est écrit dans `card_session` en base
   (`context.ts:107`) — donc il ne remonte que par l'API board, jamais par le snapshot du troupeau
   qui alimente `AgentView`.

Détail savoureux : le tracker **pousse déjà** ce chiffre dans herdr via `pane.report_metadata`
(`context.ts:140-147`), pour qu'il s'affiche en `$ctx` dans la barre latérale du TUI. **L'information
est donc visible dans le terminal herdr, et invisible dans l'app Collie qui l'a calculée.**

## 8.3 Les autres écarts, moins graves mais du même ordre

- **La branche git** est sur la carte du board mais pas sur celle de l'accueil, alors que le pane
  tourne dans un worktree — c'est souvent la seule chose qui distingue deux panes du même dépôt.
- **Le `cwd`** est sur la carte de l'accueil mais pas sur celle du board — l'exact miroir.
- **Le nom affiché** suit deux règles différentes : `paneDisplayName()` pour un pane (libellé
  utilisateur → nom `/rename` de Claude → nom d'agent, `types.ts:45-49`), et `card.title` pour une
  carte. Un même agent porte donc deux noms selon l'écran, sans lien visible entre les deux.

Aucun de ces écarts n'est absurde pris isolément — chaque vue montre ce que sa source de données
porte. Mis bout à bout, ils font que **la même chose ne se lit pas pareil selon la porte d'entrée**,
alors que le board se présente explicitement comme « une seconde lentille sur le même troupeau »
(`card-tile.tsx:10-11`).

---
