# 0063 — L'opérateur fixe combien de lots l'orchestrateur garde ouverts

**Status:** Accepted
**Date:** 2026-11-21
**Supersedes:** la règle « un lot à la fois » de [0047](./0047-the-orchestrator-may-start-a-lot-when-nothing-runs-if-the-operator-allows-it.md) (« aucun lot du dépôt ne tourne ») et de [0056](./0056-a-repo-has-one-objective-the-operator-sets-and-validates.md) (« un à la fois, refus tant qu'un lot du dépôt est ouvert »).

## Context

L'orchestrateur ne pouvait lancer un lot que si aucun autre lot du dépôt n'était ouvert : `403 « un lot
du dépôt est encore ouvert »`. La raison était la prudence — deux lots qui touchent les mêmes fichiers
finissent en PR conflictuelles et s'arrêtent. Mais la borne était codée dans le bridge, alors que c'est
un choix de débit et de quota, donc celui de l'opérateur : une idée de dix minutes attendait la fin d'un
lot d'une heure. Et le vrai risque n'est pas « deux lots », c'est « deux lots sur le même fichier ».

## Decision

- Un réglage d'autonomie par dépôt, **« Lots en parallèle » (`maxLots`, entier ≥ 1, défaut 1)**. Le défaut
  — et la migration, qui écrit 1 sur chaque dépôt existant — garde le comportement d'avant.
- L'orchestrateur (une requête qui porte `x-collie-pane`) lance un lot tant que le dépôt a **moins de
  `maxLots` lots ouverts** — au démarrage à vide (0047), sous un objectif (0056) et sur le grant de fin
  de lot (0030), qui jusque-là ne regardait pas les autres lots.
- **Garde de fichiers** : il est refusé si une carte du lot cite un fichier déjà cité par une carte d'un
  lot ouvert du dépôt (les chemins extraits des specs par `lot-overlap.ts`, Markdown exclu). Le motif
  nomme le fichier.
- Le lancement par l'opérateur reste libre : ni borne ni garde.
- Un lot lancé ne reçoit toujours pas de carte : une idée neuve part dans un petit lot lancé à côté.

## Consequences

- La garde ne voit que les fichiers **écrits** dans la spec : deux cartes qui touchent le même fichier
  sans le nommer passent, et leur seconde PR peut encore entrer en conflit. On l'accepte : c'est la
  même heuristique que l'avertissement de recouvrement d'un lot, et un conflit arrête le lot, il ne casse rien.
- `maxChain` compte toujours les lancements sans l'opérateur ; `maxLots` borne la simultanéité, pas le total.
- Avec un grant armé et un lot ouvert par l'opérateur, `maxLots` = 1 refuse désormais le lancement armé.
