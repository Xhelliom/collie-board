# 0037 — Un tour fini se lit au passage working→idle, pas à l'état `done`

**Status:** Accepted
**Date:** 2026-10-13
**Refines:** [0002](./0002-a-manual-status-ends-the-session-never-the-pane.md) (sans le contredire)

## Context

L'ADR 0002 a posé que `done` est transitoire : Herdr le rapporte un instant, puis l'agent retombe en
`idle` tout seul, et `STATUS_COLUMN` mappe `idle → working` pour que la carte ne rebondisse pas hors
de `review`. Conséquence jamais écrite : `review` n'est atteint **que** sur `done`. Un pane qui passe
`working → idle` sans que le sondage n'ait vu `done` (blip manqué, pane déjà consulté) laisse sa carte
en `working` indéfiniment ; le lead n'évalue rien, le lot attend (vu le 13/10, lot 6). Or `idle`
recouvre trois cas que le mapping confond : un agent qui démarre, un tour fini, un agent qui attend.

## Decision

**On détecte le passage, pas un état.** `bridge/idle-landing.ts`, branché sur `engine.onUpdate`
(aucune boucle de plus), tient en mémoire par pane « vu `working` à t » et « `idle` depuis t ».
Un pane vu `working` puis `idle` plus de `IDLE_LANDING_MS` (45 s) dont la carte est en `working` la
pose en `review`, raison `agent done` — celle que `board-notify.ts` lit déjà comme « le pane l'a dit » :
pas de double notification, pas de canal.

- `idle` sans `working` observé depuis le dernier prompt = démarrage : la carte reste en `working`.
- Un `card.prompted` plus récent que le dernier `working` vu remet la détection à zéro.
- `blocked` prime : il ne compte pas comme `idle`, la carte reste `blocked`.
- `reconcileOne` est inchangé : `review` + `idle` ne ramène toujours pas en `working`.
- `idle → working` reste le défaut pour une carte menée à la main (pas de passage observé, pas de
  `review`).

## Consequences

- Rien n'est persisté (carte durable, session éphémère) : **après un redémarrage du bridge le drapeau
  est perdu**. Un pane déjà idle à ce moment reste en `working` jusqu'à son prochain tour observé.
  Cas assumé.
- 45 s est un réglage : un agent qui se tait plus longtemps entre deux tours d'outils sans passer
  `working` serait posé en `review` trop tôt ; il en ressort dès qu'il retravaille (0002).
