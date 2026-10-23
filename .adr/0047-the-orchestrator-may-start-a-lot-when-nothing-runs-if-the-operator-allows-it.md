# 0047 — L'orchestrateur peut démarrer un lot quand rien ne tourne, si l'opérateur l'a permis

**Status:** Accepted — amends [ADR 0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md) (not edited: this is its successor)

## Context

ADR 0030 n'arme le droit de lancer qu'au réveil de fin de lot (`endOfLot()`). Sur Kenobu, autonomie
allumée et enchaînement illimité, l'orchestrateur a préparé un lot alors que plus rien ne tournait :
aucune fin de lot ne viendrait l'armer, et `POST /api/runs/<id>/launch` lui a renvoyé 403. Le
comportement était voulu ; il laisse quand même l'opérateur seul à pouvoir relancer un dépôt à l'arrêt.

## Decision

**Un réglage de plus dans `repo_autonomy`, éteint par défaut : `startWhenIdle`** (« Peut démarrer un
lot quand rien ne tourne »). Toujours l'opérateur seul : `PUT /api/orchestrator/autonomy` refuse tout
appel portant `x-collie-pane`. L'allumer, autonomie allumée, repart d'un enchaînement à zéro.

**Le lancement est aussi accepté** d'un pane agent, sans grant armé, quand au moment de la demande
(`idleStart()`, bridge/autonomy.ts) :

- l'autonomie et `startWhenIdle` sont allumés ;
- **aucun lot du dépôt ne tourne** — aucun run lancé et non `run.finished` ;
- le lot visé est planifié (sinon 409, comme pour l'opérateur) ;
- l'enchaînement est sous `maxChain` ;
- si `stopOnRed`, le dernier lot terminé du dépôt n'a laissé ni gate ni CI rouge.

Il se dépense comme le grant (`spendAutonomy`, qui revérifie le réglage dans le même `UPDATE`) : un lot
de plus compté dans l'enchaînement. L'audit `run.launch` porte `autonomous: true` et `reason: "idle"`.
Un lancement de l'opérateur remet le compteur à zéro, comme avant.

**Toujours pas de minuteur.** Rien ne réveille l'orchestrateur pour ça : c'est lui qui demande, et le
bridge lit la condition à la demande. Valider une phase reste le geste de l'opérateur.

## Consequences

- Toggle éteint : rien ne change par rapport à la 0030.
- Un lot en cours ferme cette voie ; la fin de ce lot repasse par `endOfLot()` et ses bornes.
- Deux demandes simultanées : la seconde voit le premier lot lancé (en cours) et est refusée.
