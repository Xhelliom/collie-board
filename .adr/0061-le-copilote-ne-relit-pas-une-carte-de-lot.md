# 0061 — Le copilote ne relit pas une carte de lot : le verdict du lead en tient lieu

**Status:** Accepted
**Date:** 2026-11-19
**Supersedes:** la ligne « 5. Judge » d'[ADR 0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md), pour sa revue copilote et le tri qui la suivait.

## Context

ADR 0017 faisait relire chaque carte de lot deux fois : le lead la juge sur le diff et le bilan, et la
revue copilote tournait quand même, puis le lead la triait (verdict accepté ou non, suites gardées,
fondues ou supprimées). La mesure de novembre ([couts-2026-11.md](../docs/dev/couts-2026-11.md), frein 5)
compte ≈ 44 % des demandes du copilote sur ces cartes déjà jugées, ≈ 11 M de tokens pondérés en deux
semaines (≈ 2 % du board), plus le tour de tri du lead.

## Decision

Une carte d'un lot **lancé** ne doit pas de revue au copilote : `listCardsOwedReview` l'écarte, et le
lot ne l'attend ni ne la trie plus (`reviewing` vaut `false`). Une carte hors lot, ou dans un lot
seulement planifié, garde sa revue. « Relire » à la main reste possible sur n'importe quelle carte.

Le critère est l'appartenance au lot, pas le verdict « finished » : le copilote part dès que la carte
passe en revue, avant que le lead ait répondu — attendre le verdict n'aurait rien économisé.

## Consequences

- Les suites qu'une revue proposait (« N follow-ups added ») n'existent plus pour une carte de lot ;
  le lead n'en propose pas. Si elles manquent, c'est au lead de les proposer, pas au copilote de revenir.
- La machinerie de tri (`Lead.triage`, l'étape `triage` de `stepFor`) reste en place mais ne se
  déclenche plus ; la supprimer est une carte à part.
- Un lot arrêté garde ses cartes : elles restent au lead, qui les reprend avec le lot.
