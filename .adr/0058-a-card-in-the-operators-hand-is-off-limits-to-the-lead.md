# 0058 — Une carte « en main » de l'opérateur est hors de portée du lead

**Status:** Accepted (design validé par l'opérateur le 10/11/2026)

## Context

L'opérateur parle à un worker — une question posée, une réponse en cours — puis part faire autre chose.
Le lead ([ADR 0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md)) reprend alors la main
au milieu de l'échange : il juge la carte, renvoie une consigne qui contredit la sienne, ou la classe et
ferme le worker. `card.operator_said` lui donnait déjà à lire ce que l'opérateur avait dit ; rien ne lui
disait de **ne pas agir**.

## Decision

**Un statut durable sur la carte, `held {by:"operator", at, lastTouch}` — « En main ».**

- **Il se pose** par le bouton « Je le prends » (carte, pane du worker) et **tout seul** dès que l'opérateur
  écrit au worker depuis l'appli : réponse ou touches sur le pane d'une carte qui a une session, ou
  instruction de suivi sur la carte, sans `x-collie-pane`. Chaque message rafraîchit `lastTouch`.
- **Tant qu'il tient**, `stepFor` ne rend aucune étape pour la carte : le lead ne juge pas, ne prompte pas,
  ne classe pas, ne ferme pas le worker ; un verdict demandé juste avant est jeté. Le reste du lot avance,
  et le lot ne finit pas sans elle. Un pane agent qui écrit à ce worker reçoit `409 {kind:"held"}`
  (`POST /api/cards/<id>/prompt`, et les routes `reply`/`keys` du pane).
- **Il se retire** par « Rendre au lead » : le lead repart de ce que la carte et son journal disent
  maintenant. Aucun round n'est consommé — seul un renvoi du lead en est un.
- **Pas de blocage indéfini.** 1 h sans message de l'opérateur : un rappel dans le slot de la meute
  ([ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md)), dont le prédicat de rétraction est
  « `held` absent ou `lastTouch` a bougé ». 1 h de plus : le statut se retire tout seul, comme le bouton, et
  la cloche dit « rendu au lead ». Tout message remet le compteur à zéro. Pas de timer : le balayage est
  accroché à `engine.onUpdate`, et « rappel déjà dit » se lit dans le journal (`card.held_reminder`).
- **Seul l'opérateur pose et retire.** `held` est hors de toute allowlist ; `POST`/`DELETE
  /api/cards/<id>/hold` répondent `403` à tout pane agent. Une session qui se termine le retire sans bruit.
- **Local, pas partagé** : il parle du pane de cette machine, il n'entre pas dans le journal git (ADR 0048).

## What this rules out

- **Un agent qui libère la carte**, ou qui contourne le `409` en tapant dans le pane par un autre chemin.
  L'orchestrateur attend ; c'est écrit dans `SKILL.md`.
- **Déduire « en main » de l'activité du pane.** Un worker qui tourne ne dit pas qui lui a parlé ; le geste
  de l'opérateur est le seul fait fiable, donc il est écrit — et c'est le seul état gardé.
- **Geler le lot entier.** Une conversation sur une carte ne vaut pas l'arrêt des autres.
- **Étendre le gel aux gestes hors lead** (handoff automatique, revue du copilot) : ils ne jugent ni ne
  ferment le travail de l'opérateur. À rouvrir si l'un d'eux coupe un échange.
