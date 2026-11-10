# Résumé

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

Le constat de départ (« toutes disent *Claude is done*, donc elles ne disent rien ») est exact, et sa
cause n'est pas un mauvais choix de formulation : **le titre d'une notification ne peut
structurellement rien dire d'autre**. Il vaut `${paneDisplayName(a)} ${verb}`
(`bridge/notifications.ts:235`), et les trois sources de nom que `paneDisplayName` consulte
(`bridge/types.ts:83-87`) sont, en pratique, toutes vides ou constantes :

| Source | État réel | Pourquoi |
|---|---|---|
| `paneLabel` (herdr `pane.rename`) | `null` sur les 9 panes | Collie ne renomme jamais un pane ; c'est un geste manuel de l'opérateur |
| `sessionName` (le `/rename` de Claude) | `null` sur les 9 panes | dépend d'un `/rename` que personne ne tape ; et posé **après** la boucle des transitions (§2.6) |
| `agent` | `"claude"` sur les 9 panes | herdr remonte le *kind* d'agent, pas le nom que Collie a choisi au lancement |

Le corps n'est pas meilleur, pour une raison distincte : il vaut
`${a.workspaceLabel} · ${a.cardTitle ?? a.cwd}` (`bridge/notifications.ts:236`), et pour un pane de
carte le `workspaceLabel` **est** le titre de la carte tronqué à 40 caractères
(`bridge/cards.ts:691`). Le corps répète donc deux fois la même chaîne et ne nomme jamais le repo.

Quant au copilot : il ne réécrit rien dans le cas nominal, parce qu'il est derrière **deux
préférences désactivées par défaut** et que le palier gratuit — le dernier message de l'agent, qui ne
coûte qu'une lecture de fichier — est enfermé derrière la préférence du copilot payant
(`bridge/index.ts:201`). C'est la réponse directe à « le copilot retravaille déjà le contenu, et
pourtant certaines restent plates » : dans la configuration par défaut, **rien ne le retravaille**.

---
