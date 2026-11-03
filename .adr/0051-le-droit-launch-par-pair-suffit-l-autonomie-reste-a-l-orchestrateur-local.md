# 0051 — Le droit `launch` par pair suffit ; l'autonomie reste à l'orchestrateur local

**Status:** Accepted
**Date:** 2026-11-03
**Amends:** [0048](./0048-board-partage-par-git-pair-a-pair-multi-utilisateur.md) § 4, la puce
*« L'autonomie du propriétaire s'applique »*. 0048 n'est pas éditée au-delà de sa ligne de statut.
**Trail:** carte 5f307b23 (03/11) — pair Windows `Dell-5550-Stef`, puis correction de l'opérateur
avant PR : *« le lancement distant ne dépend PAS de l'autonomie »*.

## Context

0048 § 4 demandait deux consentements au propriétaire d'une machine pour qu'un pair y lance un
agent : le droit `launch` par environnement dans `node.toml`, **et** l'autonomie du dépôt
(`repo_autonomy`, [0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md)
/ [0047](./0047-the-orchestrator-may-start-a-lot-when-nothing-runs-if-the-operator-allows-it.md)) —
un lancement de pair comptait comme un lancement d'orchestrateur.

Vécu le 03/11 : environnement déclaré, droit accordé, le pair refusait encore *« autonomy is off »*,
sans rien l'annoncer avant. Et allumer l'autonomie pour lever ce refus allume aussi ce qu'elle veut
dire chez soi : l'orchestrateur local qui enchaîne les lots. Sur un poste enfant, qui ne fait
qu'exécuter ce qu'on lui envoie, ce n'est pas voulu.

## Decision

**Le droit `launch` accordé par pair et par environnement est le seul consentement exigé.**
`POST /api/node/launch` ne lit plus `repo_autonomy`. Le bouton « Autoriser » (Réglages → Pairs)
écrit ce droit et rien d'autre ; il ne touche pas à l'autonomie, ni en accordant ni en retirant.

**L'autonomie redevient ce que 0030 en dit, et seulement ça** : ce que l'orchestrateur de *cette*
machine peut lancer de lui-même.

Le défaut reste fermé : un pair nouvellement appairé reçoit `launch = []` et ne lance rien.

## Rejected

- **Garder les deux et allumer l'autonomie depuis « Autoriser »** (première version de la carte) :
  un clic qui change aussi le comportement de l'orchestrateur local, sans que le geste le dise.
- **Garder les deux et seulement l'annoncer** : le diagnostic aide, mais le second consentement ne
  protège rien que le premier ne protège déjà — un pair qui n'a pas le droit ne lance pas.

## Consequences

- *« Personne ne lance plus chez moi que moi »* (0048 § 4) tient par le droit `launch`, accordé et
  retiré par le seul opérateur de la machine, par pair et par environnement.
- `/api/repos/environments` ne connaît que trois raisons de blocage : `no-environment`,
  `origin-mismatch`, `launch-not-granted`.
