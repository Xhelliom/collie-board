# Partie 4 — Règle d'événement « session terminée + carte en review »

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

## 4.1 La règle proposée

> Quand un pane bascule en `done` **et** que la carte qu'il porte est (ou devient) `review`, la
> notification porte sur **la carte à relire**, pas sur la fin de session.
>
> - marqueur : `Review` (et non `Done`) ;
> - sujet : le titre de la carte ;
> - le tap deep-linke vers **la carte**, pas vers le pane.

Le dernier point est le plus important, et il est indépendant du texte : ce que l'opérateur veut
faire en tapant sur « à relire », c'est relire — voir le diff, la review du copilot, les follow-ups.
Aujourd'hui le tap ouvre le terminal (`push.ts:57`, `sw.ts:97-105`), qui est l'endroit où il n'y a
justement plus rien à faire.

## 4.2 Pourquoi c'est réalisable sans nouvelle boucle ni nouveau hook

C'est le point qui rend cette règle bon marché, et il tient à un ordonnancement heureux.

`reconcile()` pose la carte en `review` quand son pane rapporte `done`
(`cards.ts:41` via `STATUS_COLUMN`, appliqué en `cards.ts:257-264`). Il tourne sur `onUpdate`, donc
**après** la boucle des transitions du même poll (`state-engine.ts:277-286` puis `306-308`). Au
moment exact où `onTransition` est appelé, la carte est donc encore `working` — lire son statut là
serait faux.

Mais la notification ne part pas à ce moment-là : elle est **débouncée de 30 s**
(`config.ts:273`, `notifications.ts:153-158`). Avec un poll à 1,5 s (`config.ts:271`), `reconcile()`
a tourné une vingtaine de fois avant que `onFire` ne se déclenche. **Au moment du tir, la carte est
déjà en `review`.**

Et le code lit déjà la carte à cet instant : `enrichNotification` fait
`opts.board.getCard(alert.cardId)` — mais n'en garde que le `title` et le `spec`, pour le prompt du
copilot. **Le statut de la carte est déjà chargé au bon moment, et jeté.**

Il n'y a donc ni poll à ajouter (interdit par `CLAUDE.md`, §The board), ni hook à créer : il faut
lire un champ de plus sur un objet déjà en main, au moment où `onFire` compose le résumé.

> **Livré (0.125.0)** : la lecture n'a pas été prise sur `enrichNotification` — ce chemin-là est
> celui du copilot, éteint par défaut et arrivé en second push silencieux, donc le marqueur en
> aurait dépendu. Elle est faite dans le hook de pré-tir déjà awaité entre l'expiration du débounce
> et le rendu (`index.ts`), qui tire au même instant sans rien devoir au copilot.

## 4.3 Les cas limites à trancher

| Cas | Comportement proposé |
|---|---|
| `done` mais la carte n'est **pas** en `review` (l'opérateur l'a bougée à la main entre-temps) | marqueur `Done`, sujet = titre de carte. On ne ment pas sur l'état. |
| `done` sans carte du tout | marqueur `Done`, sujet = repo. Inchangé. |
| Carte en `review` alors que le pane est reparti en `working` | pas de notification — `resolve()` a déjà rétracté (`notifications.ts:130-134`). Correct. |
| `done` sur une **sous-tâche** dont le conteneur passe aussi en `review` (`cards.ts:60`) | notifier la sous-tâche, jamais le conteneur. Le conteneur n'a pas de pane et son passage en `review` est dérivé (`cards.ts:277-283`) — le notifier ferait deux alertes pour un événement. |
| La carte passe en `review` **sans** transition de pane (ex. relance de review manuelle) | hors périmètre de cette règle : c'est une notification d'événement de board, pas de session (carte N6). **✅ tranché sous B12 et livré en 0.133.0** : le board l'émet lui-même, même marqueur `Review` et même destination que N4, autre déclencheur. |

## 4.4 Ce que cette règle ne couvre pas

Elle reste attachée à une transition de **pane**. Les événements purement board — carte orpheline,
review du copilot rendue, dépendance débloquée — n'ont toujours aucun canal. C'est une extension
naturelle une fois cette règle en place, mais c'est un autre chantier (carte N6), et il demandera de
décider si le board a le droit d'émettre des notifications de son propre chef.

> **Tranché le 2026-08-26 en [§6](../../NOTIFY_AUDIT.md#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)** :
> le board a ce droit, sous trois tests et une condition de rétraction, sans second canal. Le cas
> laissé ouvert dans le tableau ci-dessus — une carte qui entre en `review` sans transition de pane —
> y est recensé sous **B12**.

---
