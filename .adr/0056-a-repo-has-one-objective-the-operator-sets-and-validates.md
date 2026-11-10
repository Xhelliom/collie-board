# 0056 — Un dépôt a un objectif, que l'opérateur fixe et valide

**Status:** Accepted (l'objet, ses routes, son écran ; le mode objectif — voir *Le mode objectif* plus bas) ·
les choix par défaut restent **proposés** à l'opérateur, sauf « déclaré = arrêt net », tranché le 09/11 — amends [ADR 0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md)
and [ADR 0047](./0047-the-orchestrator-may-start-a-lot-when-nothing-runs-if-the-operator-allows-it.md) (not edited: this is their successor)

## Context

L'autonomie (0030, 0047) borne l'orchestrateur en **lots** : il enchaîne jusqu'à `maxChain`, puis
s'arrête. L'opérateur, lui, pense en **résultat** : « v1 livrée, CI verte, doc écrite ». La phase
« Autonomie par objectif » ajoute un mode plus agressif où l'orchestrateur travaille vers ce résultat,
dans un budget, sans que l'opérateur ait à relancer ni à valider chaque jalon. Il lui faut d'abord un
objet sur lequel cette autonomie se règle.

## Decision

**Un objet `goal` par dépôt** : un texte, des critères de réussite (liste), un budget
`{maxLots, quotaPct, deadline?}` et un statut `active` · `paused` · `claimed` · `achieved` · `abandoned`.
**Un seul objectif ouvert** (`active`, `paused` ou `claimed`) par dépôt — un index unique partiel le tient,
pas une lecture avant écriture. Fermé (`achieved`, `abandoned`), il est figé et libère la place.

**L'objectif est le geste de l'opérateur.** Créer, éditer, mettre en pause, reprendre, abandonner et
**valider** (`achieve`) refusent tout appel portant `x-collie-pane` (403). Un pane agent peut le lire et
**revendiquer** qu'il est atteint (`claim`, depuis `active`) ; seul l'opérateur le passe à `achieved` —
ou le reprend (`resume`), ce qui rejette la revendication. Même règle que la phase (0025) : l'agent
propose, l'opérateur valide.

**Le budget consommé se lit, il ne se déclare pas.** Les lots d'un objectif sont les lots du dépôt lancés
pendant qu'il était ouvert (`createdAt` ≤ `launchedAt` ≤ `endedAt`) ; ses cartes, leurs membres. Le
quota est la jauge de la semaine (« all models ») que le tableau de bord lit déjà, prise en cache —
jamais un CLI lancé pour une lecture d'objectif. Aucune colonne `goalId` sur un lot.

**Choix par défaut proposés** (à confirmer par l'opérateur, décision ouverte) :

- l'opérateur seul valide l'objectif atteint ;
- pendant un objectif, les phases que l'orchestrateur découpe ne se valident pas une à une : la
  validation de l'objectif les clôt ;
- budget par défaut **10 lots**, arrêt à **80 %** du quota de la semaine, échéance optionnelle.

## What this rules out

**Un objectif écrit par un agent.** Comme le réglage d'autonomie, la route d'écriture est le seul endroit
où vit la garantie — sinon l'orchestrateur se fixerait son propre but et son propre budget.
**Plusieurs objectifs ouverts par dépôt.** Le budget ne saurait plus à quoi s'imputer.
**Une revendication qui vaut validation.** `claimed` n'est qu'une proposition.

## Consequences

- Ce lot livre l'objet, ses routes (`/api/goals`) et son bloc sur la page projet. Que l'orchestrateur
  **dépense** ce budget (lancer sans `maxChain` tant que l'objectif est actif et sous budget, s'arrêter
  à la borne, clore les phases à la validation) est le lot suivant de la phase ; d'ici là l'autonomie
  reste celle de 0030/0047, et l'objectif se lit sans rien commander.
- L'objectif est local à la machine : il n'entre pas au journal partagé (ADR 0048), comme l'autonomie.
- Les sauvegardes portent la table `goal`.

## Le mode objectif (lot suivant de la phase)

**Tout part du réveil de fin de lot (0028), pas de nouvelle boucle.** `endOfLot()` lit d'abord l'objectif
ouvert du dépôt :

- **actif** : il remplace `enabled` et `maxChain`. Un lot planifié : lancement permis. Rien de planifié :
  le réveil dit « objectif pas atteint : relis les critères, planifie et lance la suite » et rappelle les
  décisions qui attendent l'opérateur (elles ne bloquent que leur branche). L'orchestrateur lance lui-même
  le lot qu'il a planifié, **un à la fois** (refus tant qu'un lot du dépôt est ouvert), sans grant armé.
- **borne atteinte** (lots, quota de la semaine, échéance, ou rouge avec `stopOnRed` — après la borne de
  reprises du lot, 0055) : l'objectif passe en `paused` ; le passage `active → paused` est ce qui fait que
  l'opérateur est prévenu **une fois**. En pause, l'autonomie 0030/0047 reprend la main.
- **déclaré (`claimed`) = arrêt net** (tranché le 09/11) : aucun lot créé ni lancé par un pane, aucun réveil
  de fin de lot, budget gelé, même après 24 h. Reprendre un objectif déclaré, c'est **refuser** la
  déclaration : un commentaire est exigé, et c'est le journal `goal.resumed` qui réveille l'orchestrateur.

**Le rattachement reste dérivé** : sont à l'objectif les lots lancés ou planifiés pendant qu'il était ouvert,
leurs cartes, et les phases du dépôt créées pendant ce temps (et leurs cartes). Le budget ne compte que les
lots lancés. **Valider l'objectif clôt ses phases** encore ouvertes sans lot en cours ; le réveil ne propose
plus de valider une phase pendant l'objectif.
