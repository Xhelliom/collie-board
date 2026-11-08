# Partie 1 — Inventaire de ce qui est émis aujourd'hui

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

## 1.1 Les événements qui produisent une notification

Il n'y en a que **trois**, et un seul concerne les agents.

| # | Événement déclencheur | Où | Canal |
|---|---|---|---|
| E1 | Un pane agent **entre** dans `blocked` (transition observée d'un poll à l'autre) | `state-engine.ts:277-286` → `notifications.ts:136-160` | push + cloche + toast |
| E2 | Un pane agent **entre** dans `done` | idem | push + cloche + toast |
| E3 | Une release Collie plus récente est détectée | `update.ts:247` → `index.ts:134-143` | push seulement |

Et **trois** rétractations, qui ferment la notification au lieu d'en montrer une :

| # | Événement | Où |
|---|---|---|
| R1 | Le pane quitte `blocked`/`done` pour un état non notifiable | `notifications.ts:130-134` |
| R2 | Le pane disparaît du snapshot | `notifications.ts:163-165` |
| R3 | L'opérateur active le snooze | `server.ts:368-373` |

**Ce qui n'est jamais notifié, alors que la carte existe** : une carte qui entre en `review`, une
carte qui passe `orphaned`, une review du copilot qui rend son verdict, un merge/PR terminé, une
carte débloquée par une dépendance. Aucun de ces faits ne franchit la frontière du board vers la
notification — la seule chose observée est le statut du **pane**.

## 1.2 Ce que porte chaque notification, par canal

Le `NotificationCoordinator` regroupe tout ce qui est en attente dans **une seule** notification par
session herdr (`notifications.ts:226-251`). Il y a donc deux formes de contenu, pas une.

### Forme A — une seule alerte en cours (`notifications.ts:234-239`)

| Champ | Formule | Rendu réel observé (carte de cet audit) |
|---|---|---|
| Titre | `${paneDisplayName(a)} ${verb}` | `claude is done` / `claude needs you` |
| Corps | `${a.workspaceLabel} · ${a.cardTitle ?? a.cwd}` | `Auditer la pertinence des notifications  · Auditer la pertinence des notifications et redéfinir leur contenu` |
| Tap | deep-link vers le pane | `/pane/w3D:p1` |

*Vérifié en direct* : pour le pane `w3D:p1`, `workspaceLabel = "Auditer la pertinence des notifications "`
(40 caractères, espace final compris) et `cardTitle = "Auditer la pertinence des notifications et redéfinir leur contenu"`.

### Forme B — plusieurs alertes en cours (`notifications.ts:241-250`)

| Champ | Formule | Rendu réel |
|---|---|---|
| Titre | `${n} agents need you` / `${n} agents done` / `${n} agents need attention` | `3 agents done` |
| Corps | les noms joints | `claude, claude, claude` |
| Tap | pas de deep-link | ouvre `/` |

La forme B est **strictement moins informative** que la forme A, et elle est atteinte dès la
deuxième alerte simultanée. Sur un board qui fait tourner 3 à 5 agents, c'est la forme courante.

### E3 — notification de mise à jour (`index.ts:134-143`)

| Champ | Valeur |
|---|---|
| Titre | `Collie update available` |
| Corps | `Version <x.y.z> is available` |
| Tap | `/settings` |

Celle-ci est la seule qui dit exactement ce qu'elle a à dire. Elle contourne le snooze et a son
propre `topic` de collapse (`push.ts:31`).

## 1.3 Les trois surfaces, et leur divergence

> **Refermé en 0.124.0 (N9)** — les trois surfaces composent désormais par `notifyContent()`, dont
> `web/src/lib/notify-content.ts` est une copie **octet pour octet** de `bridge/notify-content.ts`
> (un test compare les deux fichiers et casse le build à la moindre dérive). Le tableau ci-dessous
> décrit l'état d'avant : il reste la raison du changement. Ce que les surfaces in-app ajoutent au
> push tient en un champ optionnel — la session du troupeau quand ce n'est pas la principale.

Les mêmes faits sont rendus trois fois, **par trois codes différents**, avec trois niveaux de
richesse :

| Surface | Code | Titre | Corps | Sous-titre copilot |
|---|---|---|---|---|
| **Push OS** | `notifications.ts:226-251` (bridge) | `claude is done` | `label · titre` | oui, en second push silencieux |
| **Toast in-app** | `use-transitions.ts:41-53` (web) | `claude is done · CrewDesign` | `titre de carte` | **non**, jamais (durée de vie trop courte) |
| **Cloche** | `notification-bell.tsx:148-156` (web) | `claude is done · CrewDesign` | `subtitle ?? titre ?? cwd` | oui, rétro-patché |

Le toast et la cloche partagent des helpers (`notifyVerb`, `notifyWhere`, `notifyWhat` dans
`web/src/lib/types.ts:80-104`) qui séparent proprement **où** ça s'est passé et **quoi**. Le push,
lui, refait ce calcul à la main côté bridge, avec une composition différente : le « où » y est collé
en tête du corps au lieu du titre. **Le push est la surface la moins bien servie des trois**, alors
que c'est la seule qui compte quand le téléphone est dans la poche.

## 1.4 Ce qui décide si une notification part

| Verrou | Défaut | Où |
|---|---|---|
| `NotifyPrefs.blocked` | **on** | `notify-prefs.ts:31` |
| `NotifyPrefs.done` | **off** | `notify-prefs.ts:32` |
| `NotifyPrefs.updates` | on | `notify-prefs.ts:33` |
| `NotifyPrefs.copilotSubtitle` | **off** | `notify-prefs.ts:34` |
| Copilot lui-même (`COLLIE_BOARD_COPILOT`) | **off** | `CLAUDE.md`, §The board |
| Snooze actif | off | `snooze.ts` |
| Un onglet Collie visible | — | `push-decision.ts:60` (suppression du push) |
| Debounce | **30 s** | `config.ts:273` |

---
