# 6.2 Le déclencheur commun existe déjà, et ce n'est pas une boucle : le journal — ✅ écrit en 0.129.0

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

> **Livré (0.129.0, `aeec4a1`)** : `bridge/board-notify.ts`, exactement la forme décrite ci-dessous —
> `db.eventsAfter(cursor)` (`WHERE id > ? ORDER BY id`) sur un curseur en mémoire initialisé à
> `db.lastEventId()` au démarrage, appelé depuis le **sixième** `engine.onUpdate` de `index.ts`.
> Le `tell()` du module est le filtre de §6.1 rendu lisible en un endroit : trois types retenus, les
> trente autres jetés.

Presque tout ce que la Partie 5 appelait « un chantier » est **déjà écrit dans la base**. La table
`event` (`db.ts:478-485`) est un journal append-only à clé primaire auto-incrémentée, et 33 types y
sont posés aujourd'hui par tous les chemins confondus — poll, route HTTP, copilot :

```
card.agent_adopted · card.cleaned_up · card.cleanup_failed · card.created · card.discarded
card.edited · card.merge_failed · card.merged · card.pr_failed · card.pr_opened · card.prompted
card.resolve_requested · card.split_from · card.start_failed · card.status · card.worktree
copilot.explained · copilot.explain_failed · copilot.refined · copilot.refine_failed
copilot.reformulated · copilot.reformulate_failed · copilot.review_failed · copilot.split_kept
handoff.completed · handoff.expired · handoff.failed · handoff.requested
review.created · session.closed · session.opened · wrapup.collected · wrapup.expired · wrapup.failed
```

Le déclencheur unique de toute la Partie 6 tient donc en une phrase : **un consommateur accroché à
`engine.onUpdate` (session primaire, comme `reconcile`, `ContextTracker`, `HandoffCoordinator`,
`WrapupCoordinator` et `CopilotCoordinator` — `index.ts:280-308`) qui fait
`SELECT … FROM event WHERE id > ?` avec un curseur en mémoire.**

Pourquoi c'est bon marché, point par point :

| | |
|---|---|
| **Nouvelle boucle** | Aucune. C'est le sixième `engine.onUpdate` d'une liste qui en compte déjà cinq. |
| **Coût par tick** | Une requête de plage sur la clé primaire (`WHERE id > ?` = un parcours du rowid) qui rend zéro ligne dans le cas normal. Moins cher que `reconcile()`, qui interroge déjà `listOpenSessions` + `childStatusesByParent` à chaque tick. |
| **Curseur** | Initialisé au dernier `id` au démarrage, en mémoire. Un restart ne rejoue donc pas le passé — même posture que `NotifyLog` et `CopilotCoordinator.busyCards` : runtime, non persisté (`CLAUDE.md` §The board). |
| **Ratés** | Impossible de manquer un fait entre deux polls, contrairement à un diff de snapshots : le journal est écrit par l'action, pas dérivé d'un état. |
| **Snapshot `disconnected`** | Sans objet — le tailer ne lit pas le snapshot, et `onUpdate` n'est de toute façon appelé qu'après un poll réussi (`state-engine.ts:306-309` : le `catch` sort avant). Les gardes des autres consommateurs restent, elles, nécessaires : elles protègent des lectures de snapshot. |
| **Surface upstream** | Un fichier neuf (`bridge/board-notify.ts`), un `engine.onUpdate` de plus dans `index.ts`. `notifications.ts` n'est touché que si l'on veut la coalescence (§6.4). |

Le tailer ne décide de rien : il ramasse tout, et ce sont les trois tests de §6.1 qui filtrent. Un
`card.merged` passera par lui et sera jeté — c'est normal, le filtre est le fait, pas le déclencheur.
