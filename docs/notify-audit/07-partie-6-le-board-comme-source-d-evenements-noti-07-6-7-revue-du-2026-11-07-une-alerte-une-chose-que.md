# 6.7 Revue du 2026-11-07 : une alerte = une chose que seul l'opérateur peut faire

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

> Déclencheur : le 07/11 à 20:43 la cloche a dit « Needs you · Fin de lot… PR open — auto-merge is
> off for this repo; merge it yourself », et le lot a mergé la PR deux minutes plus tard. L'alerte
> n'était pas fausse sur le fait (GitHub refusait l'auto-merge) mais sur l'action : quelqu'un
> d'autre que l'opérateur allait la faire. D'où une quatrième question, à poser après les trois tests
> de §6.1 : **si l'opérateur ne fait rien, est-ce que quelqu'un d'autre le fera ?** Si oui, se taire.

**Numérotation.** Le code appelait « B13 » le refus d'auto-merge, alors que le tableau de §6.3 donne
B13 à « Run arrêté ». Le refus d'auto-merge devient **B15** (code, tests, ce tableau) ; B13 reste la
halte de lot.

Chaque alerte que le board lève de son propre chef, ce que l'opérateur doit faire, et si quelqu'un
d'autre peut le faire à sa place :

| # | Alerte (surface · marqueur) | Ce que l'opérateur doit faire | Quelqu'un d'autre le fera ? | Verdict |
|---|---|---|---|---|
| **B1** | carte orpheline (push · `Stalled`) | relancer la carte depuis son dernier handoff | non — rien ne relance un pane disparu | garde ; **décision D1** pour un membre de lot |
| **B2** | review copilot rendue (cloche · `Done`) | lire le verdict, archiver ou rouvrir | non hors lot | garde ; **décision D2** pour un membre de lot |
| **B4** | dépendance levée (push · `Ready`, off par défaut) | démarrer la carte | **oui si elle est dans un lot lancé et non fini** : le lot la démarre | **✅ corrigé** — un successeur d'un lot lancé n'est plus annoncé ; un lot seulement planifié, ou fini, l'est encore |
| **B5** | handoff échoué / expiré (push · `Stalled`) | reprendre la carte à la main | non | garde |
| **B7** | nettoyage automatique refusé (cloche · `Needs you`) | merger, pousser ou jeter la worktree / branche | non | garde |
| **B10** | demande copilot échouée (cloche · `Needs you`) | redemander | non — c'était un tap | garde ; **décision D3** pour `review_failed` |
| **B12** | carte en `review` sans pane (push · `Review`, pref. `done`) | relire | non | garde ; **décision D4** pour le geste fait à la main |
| **B13** | lot arrêté (push · `Needs you`) | reprendre la carte que le lead a rendue | non — c'est la définition d'une halte | garde |
| **B14** | lot terminé (push · `Done`) | relire, archiver | non | garde |
| **B15** | auto-merge refusé par GitHub (cloche · `Needs you`) | activer l'auto-merge sur le dépôt, ou merger la PR | **oui quand le board la merge lui-même** (`landPr`, gate verte, ADR 0027) | **✅ corrigé** — le refus porte `boardMerges: true` et se tait ; sans gate verte il sonne encore |
| — | copilot muet, 3 reviews de suite en échec (push · `Stalled`) | aller voir son pane (souvent une modale) | non | garde |
| — | note d'agent `agent.notify` (push · selon l'agent) | ce que dit la note | — | hors revue : c'est l'agent qui parle (ADR 0019), pas le board |

**Ce que vaut le correctif B15.** Le seul appelant d'`armAutoMerge` est `landPr`, appelé par un lot à
l'ouverture de sa PR. Gate verte : le board merge lui-même (`mergeWhenReady`) — B15 se tait, et si
ce merge est refusé à son tour (check rouge, conflit, PR fermée…), c'est la halte du lot (B13,
`PR not merged: …`) qui le dit. Gate rouge ou absente : personne ne merge, B15 sonne. Reste un doublon
assumé dans ce second cas : la halte B13 suit aussi, deux entrées pour une décision — voir D5.

**Décisions proposées** (non tranchées ici, chacune demande de lire le code du lot avant de coder) :

- **D1 — B1 sur un membre de lot.** Si le coordinateur de lot relance ou halte lui-même un membre dont
  le pane a disparu, B1 double B13 (ou annonce une action que le lot fera). Proposition : vérifier ce
  que fait `run.ts` d'un membre `orphaned` ; s'il halte, taire B1 pour un membre de lot ouvert.
- **D2 — B2 sur un membre de lot.** Si le lead consomme la review du copilot pour décider du tour
  suivant, l'opérateur n'a rien à en faire avant la fin du lot. Proposition : taire B2 pour un membre
  d'un lot ouvert, B14 suffisant à la fin.
- **D3 — B10 `copilot.review_failed`.** « Redemander » n'est un geste de l'opérateur que s'il avait
  demandé la review ; une review lancée par l'atterrissage n'a pas de demandeur, et trois échecs de
  suite lèvent déjà « copilot muet ». Proposition : ne garder B10 que pour `refine`/`explain`/
  `reformulate`, qui sont des taps.
- **D4 — B12 après un geste à la main.** Une carte posée en `review` depuis le téléphone se notifie
  elle-même 30 s plus tard (encadré de l'étape 3) : l'opérateur avait le doigt dessus, ce qui échoue au
  test 1. Proposition : taire B12 quand la `reason` dit un geste de l'opérateur.
- **D5 — B15 sans gate verte dans un lot.** La halte B13 dit déjà « PR not merged: the gate is red ».
  Proposition : taire B15 pour toute carte de lot (`gate` présent) et ne le garder que pour une PR
  ouverte hors lot — aucun chemin n'arme l'auto-merge hors lot aujourd'hui, ce qui reviendrait à
  retirer B15. À trancher avec le critère « B15 se lève encore pour une PR que personne ne mergera ».

---
