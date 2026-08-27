# Audit des notifications — Collie Board 0.117.0

> Document en français : c'est la langue de la demande. Le reste du dépôt reste en anglais.
> Rédigé le 2026-08-25 sur la branche `board/audit-pertinence-notifications`.
>
> **Ce document n'implémente rien.** C'est un inventaire, un diagnostic et un jeu de propositions.
> Chaque constat cite `fichier:ligne` pour être vérifiable et contestable séparément.

## Méthode et limites

Deux sources, croisées :

1. **Lecture de code** — la chaîne complète d'une notification, du poll herdr à l'affichage :
   `state-engine.ts` → `notifications.ts` → `notify-subtitle.ts` / `notify-log.ts` → `push.ts` →
   `web/src/lib/push-decision.ts` → `web/src/sw.ts`, plus les trois surfaces d'affichage
   (push OS, toast in-app `use-transitions.ts`, cloche `notification-bell.tsx`).
2. **Snapshot réel** de l'instance en service, lu le 2026-08-25 sur `GET /api/snapshot`
   (127.0.0.1:8788), 9 panes agents dont 3 adossés à une carte. C'est ce snapshot qui transforme
   plusieurs déductions de lecture en faits observés — ils sont signalés « *vérifié en direct* ».

Ce qui n'est **pas** couvert : le rendu réel des notifications sur iOS Safari vs Chrome Android
(troncatures exactes des titres/corps), et la latence réelle du copilot (aucune mesure faite ici,
seulement le timeout configuré).

---

## Sommaire

- [Résumé](#résumé)
- [Partie 1 — Inventaire](#partie-1--inventaire-de-ce-qui-est-émis-aujourdhui)
- [Partie 2 — Pourquoi c'est plat](#partie-2--pourquoi-cest-plat)
- [Partie 3 — Proposition de contenu](#partie-3--proposition-de-contenu)
- [Partie 4 — Règle d'événement « session terminée + carte en review »](#partie-4--règle-dévénement--session-terminée--carte-en-review-)
- [Partie 5 — Cartes à créer](#partie-5--cartes-à-créer)
- [Partie 6 — Le board comme source d'événements](#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)

---

## Résumé

Le constat de départ (« toutes disent *Claude is done*, donc elles ne disent rien ») est exact, et sa
cause n'est pas un mauvais choix de formulation : **le titre d'une notification ne peut
structurellement rien dire d'autre**. Il vaut `${paneDisplayName(a)} ${verb}`
(`bridge/notifications.ts:235`), et les trois sources de nom que `paneDisplayName` consulte
(`bridge/types.ts:83-87`) sont, en pratique, toutes vides ou constantes :

| Source | État réel | Pourquoi |
|---|---|---|
| `paneLabel` (herdr `pane.rename`) | `null` sur les 9 panes | Collie ne renomme jamais un pane ; c'est un geste manuel de l'opérateur |
| `sessionName` (le `/rename` de Claude) | `null` sur les 9 panes | dépend d'un `/rename` que personne ne tape ; et posé **après** la boucle des transitions (§2.6) |
| `agent` | `"claude"` sur les 9 panes | herdr remonte le *kind* d'agent, pas le nom que Collie a choisi au lancement |

Le corps n'est pas meilleur, pour une raison distincte : il vaut
`${a.workspaceLabel} · ${a.cardTitle ?? a.cwd}` (`bridge/notifications.ts:236`), et pour un pane de
carte le `workspaceLabel` **est** le titre de la carte tronqué à 40 caractères
(`bridge/cards.ts:691`). Le corps répète donc deux fois la même chaîne et ne nomme jamais le repo.

Quant au copilot : il ne réécrit rien dans le cas nominal, parce qu'il est derrière **deux
préférences désactivées par défaut** et que le palier gratuit — le dernier message de l'agent, qui ne
coûte qu'une lecture de fichier — est enfermé derrière la préférence du copilot payant
(`bridge/index.ts:201`). C'est la réponse directe à « le copilot retravaille déjà le contenu, et
pourtant certaines restent plates » : dans la configuration par défaut, **rien ne le retravaille**.

---

## Partie 1 — Inventaire de ce qui est émis aujourd'hui

### 1.1 Les événements qui produisent une notification

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

### 1.2 Ce que porte chaque notification, par canal

Le `NotificationCoordinator` regroupe tout ce qui est en attente dans **une seule** notification par
session herdr (`notifications.ts:226-251`). Il y a donc deux formes de contenu, pas une.

#### Forme A — une seule alerte en cours (`notifications.ts:234-239`)

| Champ | Formule | Rendu réel observé (carte de cet audit) |
|---|---|---|
| Titre | `${paneDisplayName(a)} ${verb}` | `claude is done` / `claude needs you` |
| Corps | `${a.workspaceLabel} · ${a.cardTitle ?? a.cwd}` | `Auditer la pertinence des notifications  · Auditer la pertinence des notifications et redéfinir leur contenu` |
| Tap | deep-link vers le pane | `/pane/w3D:p1` |

*Vérifié en direct* : pour le pane `w3D:p1`, `workspaceLabel = "Auditer la pertinence des notifications "`
(40 caractères, espace final compris) et `cardTitle = "Auditer la pertinence des notifications et redéfinir leur contenu"`.

#### Forme B — plusieurs alertes en cours (`notifications.ts:241-250`)

| Champ | Formule | Rendu réel |
|---|---|---|
| Titre | `${n} agents need you` / `${n} agents done` / `${n} agents need attention` | `3 agents done` |
| Corps | les noms joints | `claude, claude, claude` |
| Tap | pas de deep-link | ouvre `/` |

La forme B est **strictement moins informative** que la forme A, et elle est atteinte dès la
deuxième alerte simultanée. Sur un board qui fait tourner 3 à 5 agents, c'est la forme courante.

#### E3 — notification de mise à jour (`index.ts:134-143`)

| Champ | Valeur |
|---|---|
| Titre | `Collie update available` |
| Corps | `Version <x.y.z> is available` |
| Tap | `/settings` |

Celle-ci est la seule qui dit exactement ce qu'elle a à dire. Elle contourne le snooze et a son
propre `topic` de collapse (`push.ts:31`).

### 1.3 Les trois surfaces, et leur divergence

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

### 1.4 Ce qui décide si une notification part

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

## Partie 2 — Pourquoi c'est plat

### 2.1 — Le titre ne peut pas dire autre chose que « claude »

> **Corrigé en 0.121.0.** Le titre du push ne passe plus par `paneDisplayName` : il vaut
> `<marqueur> · <sujet>` (`bridge/notify-content.ts`), où le sujet est le titre de carte, sinon le
> repo. Le nom de l'agent ne figure plus dans le push ; il nomme encore l'alerte dans la cloche, le
> toast in-app et le digest multi-agents. Le diagnostic ci-dessous reste la raison du changement.

`paneDisplayName` (`bridge/types.ts:83-87`) essaie trois sources dans l'ordre. *Vérifié en direct*
sur les 9 panes agents de l'instance : `paneLabel` et `sessionName` sont `null` **partout**, et
`agent` vaut `"claude"` **partout** — y compris pour les 3 panes adossés à une carte.

Le point contre-intuitif est le troisième. Collie choisit pourtant un nom d'agent parlant au
lancement d'une carte : `agentNameFor(branch)` (`bridge/cards.ts:377-387`), passé à `agent.start`
(`bridge/cards.ts:562`). Mais ce nom est le nom de la **session d'agent** côté herdr ; le champ
`agent` que herdr remonte dans le snapshot est le *kind* (`"claude"`), comme le montre l'exemple de
`HERDR_API.md:249`. Le nom choisi par Collie n'est donc jamais lu par personne.

**Conséquence** : les trois branches de `paneDisplayName` convergent vers la même constante. Le titre
est une fonction constante de l'agent, et un discriminant nul entre deux notifications.

### 2.2 — Le corps dit deux fois la même chose et ne dit jamais le repo

> **Corrigé en 0.121.0.** Le corps vaut `<repo> · <ce qui s'est passé>`, le repo étant omis quand il
> est déjà le sujet du titre — il apparaît donc exactement une fois, carte ou pas. Le repli
> `cardTitle ?? cwd` a disparu : sans sous-titre, le corps se réduit au repo (ou à rien), jamais à
> une deuxième copie du titre. Le repo est dérivé du `cwd` (`repoOf`), à l'ancre `worktrees/`.

`body = ${a.workspaceLabel} · ${a.cardTitle ?? a.cwd}` (`notifications.ts:236`).

Pour un pane de carte, le workspace herdr a été créé avec `label: card.title.slice(0, 40)`
(`bridge/cards.ts:691`). Donc `workspaceLabel` **est** `cardTitle` tronqué. Le corps vaut
`«titre[0..40]» · «titre»`.

*Vérifié en direct*, les trois panes de carte du snapshot :

```
"Auditer la pertinence des notifications " · "Auditer la pertinence des notifications et redéfinir leur contenu"
"Mesurer la lecture des dossiers et évalu" · "Mesurer la lecture des dossiers et évaluer un cache hors navigateur"
"Vérifier si collie-board est isofonction" · "Vérifier si collie-board est isofonctionnel avec Cursor et Codex"
```

L'hypothèse implicite du code — « `workspaceLabel` = le repo » — n'est vraie que pour les panes
**hors carte** (`CrewDesign`, `elber`, `crosspatch` dans le snapshot). C'est précisément le cas où il
n'y a pas de carte. Autrement dit : **le repo n'est présent dans la notification que quand il n'y a
rien d'autre à dire, et absent dès qu'il y a une carte.**

Le repo est pourtant disponible à deux endroits au moment du tir : dans `cwd`
(`~/.herdr/worktrees/<REPO>/<branche>`) et dans `card.repoPath`, que `enrichNotification` lit déjà
(`notify-subtitle.ts:127`). Un helper existe même côté web : `repoName()`
(`web/src/lib/board.ts:383-385`).

### 2.3 — Le palier gratuit de réécriture est verrouillé derrière le palier payant

> **Corrigé en 0.120.0** (`e92bec1`). `enrichNotification` est appelé sans condition depuis
> `index.ts` ; `copilotSubtitle` est replié dans l'option `copilot.enabled` passée à l'appel, donc
> la préférence ne gate plus que la reformulation payante. La description ci-dessous décrit l'état
> **avant** ce correctif.

C'est la cause principale de « ça reste plat *malgré* le copilot ».

`enrichNotification` a deux paliers, conçus explicitement pour être indépendants (en-tête de
`notify-subtitle.ts:5-13`) :

- **palier rapide** — le dernier message de l'agent, lu dans le transcript. Coût : une lecture de
  fichier, 10 à 60 ms. Aucun quota, aucun agent.
- **palier lent** — le copilot reformule. Coût : un tour d'agent sérialisé.

Mais l'appel entier est gardé par `if (notifyPrefs.current().copilotSubtitle)` (`bridge/index.ts:201`),
une préférence dont la documentation ne parle que du copilot (`notify-prefs.ts:23-28`) et qui est
**off par défaut**. Le palier gratuit ne s'exécute donc jamais tant que l'opérateur n'a pas activé
une option qui se présente comme « laisser le copilot dépenser du quota ».

Et même activée, la préférence ne sert à rien si `COLLIE_BOARD_COPILOT` est off : `copilot.ask()`
retourne `null` immédiatement (`copilot.ts:794`). Il faut donc **deux** interrupteurs pour obtenir
une réécriture, et **un seul mal nommé** pour obtenir la lecture gratuite du transcript.

### 2.4 — Quand le copilot est activé, il est en concurrence avec lui-même

Le copilot est un seul pane, sérialisé : « one pane is one queue » (`copilot.ts:746-747`), avec un
timeout de 5 minutes par requête (`copilot.ts:40`).

Or, quand une session se termine, **deux** demandes partent quasi simultanément :

1. `enrichNotification` → `notifySubtitlePrompt` (depuis `onFire`, `index.ts:202`) ;
2. `CopilotCoordinator.update()` → `review(card)` sur la carte qui vient d'entrer en `review`
   (`copilot.ts:1282-1296`), déclenché par le même poll.

Elles entrent dans la même file. La review d'une carte lit le spec, l'acceptance, le `--stat` et le
handoff : c'est le tour long. Le sous-titre de notification, qui est le tour court et le seul dont la
valeur se périme, peut donc attendre derrière — jusqu'à 5 minutes dans le pire cas, et davantage si
plusieurs cartes atterrissent ensemble.

### 2.5 — Deux gardes suppriment le sous-titre quand il finit par arriver

`pushSubtitle` ne rend la mise à jour que si `coordinator.currentSolo(paneId)` répond
(`notify-subtitle.ts:105-109`), ce qui exige **deux** conditions (`notifications.ts:167-169`) :

- l'alerte est toujours en cours (le pane n'est pas reparti en `working`, n'a pas été traité) ;
- elle est **la seule** en cours.

La seconde est celle qui mord. Dès qu'un deuxième agent bascule, la notification devient le digest
`3 agents done` / `claude, claude, claude` et **tous** les sous-titres en vol sont jetés. Combiné à
§2.4 (le sous-titre arrive tard), c'est un mécanisme qui perd précisément dans le cas où on en aurait
le plus besoin : plusieurs agents qui finissent dans la même fenêtre.

> **Relu en 0.126.0 (§3.5, carte N5) : la garde reste.** Ce qu'elle jette n'est plus la seule chance
> d'avoir un corps informatif — depuis que le digest compte par état et nomme les sujets, il en a un
> par construction. Le raisonnement complet, y compris pourquoi le copilote ne passe pas sur le
> digest, est en [§3.5](#35-le-digest-multi-agents).

### 2.6 — `sessionName` est renseigné après la boucle des transitions

Bug secondaire, mais réel et cohérent avec §2.1. Dans `StateEngine.poll()`, la boucle qui appelle les
listeners de transition est aux lignes 277-286 ; `enrichSessionNames()`, qui pose `a.sessionName`,
est appelée ligne 298 — **après**. L'objet `AgentView` remis à `NotificationCoordinator.onTransition`
n'a donc jamais son `sessionName`, même quand le cache le connaît depuis le poll précédent
(`state-engine.ts:348-351`).

Le toast in-app, lui, lit le snapshot final : il a le nom. C'est une des divergences de §1.3.

En pratique, ça ne change rien aujourd'hui puisque `sessionName` est vide partout — mais ça signifie
que « demander à l'opérateur de faire `/rename` » ne réparerait **pas** le push, seulement le toast.

### 2.7 — `done` est off par défaut, et c'est cohérent avec le reste

Une notification « claude is done » sans sujet ne vaut effectivement pas un buzz : le défaut
`done: false` (`notify-prefs.ts:32`) est le bon réglage **pour le contenu actuel**. Ce défaut est
donc un symptôme, pas une cause — et il est ce qu'il faudra reconsidérer une fois le contenu réparé,
pas avant.

### 2.8 — Récapitulatif des causes

| # | Cause | Effet | Coût de correction |
|---|---|---|---|
| C1 | `paneDisplayName` retombe toujours sur `"claude"` (§2.1) | titre non discriminant | faible — changer le sujet du titre |
| C2 | `workspaceLabel` = titre de carte tronqué (§2.2) | corps redondant, repo absent | faible — lire `repoPath`/`cwd` |
| C3 | palier gratuit gardé par la pref copilot (§2.3) | aucune réécriture par défaut | **très faible** — déplacer un `if` |
| C4 | file copilot partagée avec la review (§2.4) | sous-titre tardif | moyen — priorité ou file séparée |
| C5 | garde `currentSolo` + digest (§2.5) | sous-titre jeté à ≥2 alertes | moyen — repenser le digest |
| C6 | `sessionName` posé trop tard (§2.6) | push moins riche que le toast | très faible |
| C7 | trois compositions de contenu concurrentes (§1.3) | divergence des surfaces | moyen — factoriser |

---

## Partie 3 — Proposition de contenu

### 3.1 Le principe : changer le **sujet** de la phrase

Aujourd'hui le sujet grammatical est l'agent (`claude is done`). L'agent est la chose la moins
intéressante et la moins distinctive de l'événement : il y en a un par pane et ils s'appellent tous
pareil. **Le sujet doit être le travail, pas l'ouvrier.**

Ordre de priorité proposé pour le sujet, du plus discriminant au moins :

1. le **titre de la carte** quand le pane en a une ;
2. le **repo** (`repoName(cwd)` ou `workspaceLabel`) sinon.

### 3.2 Titre et corps proposés

> **Implémenté en 0.121.0** — `bridge/notify-content.ts`, une composition unique partagée par le push
> initial (`notifications.ts`) et par chaque mise à jour de sous-titre (`notify-subtitle.ts`), de
> sorte que les deux chemins ne peuvent plus produire deux phrases différentes. **Une réserve :** le
> marqueur `Review` attend la règle d'événement de la partie 4 — jusque-là un `done` de carte lit
> `Done`. Le corps du digest multi-agents (§3.5) est laissé tel quel, son arbitrage restant ouvert.

Une seule règle, deux champs :

> **Titre** = `<marqueur d'état> · <sujet>`
> **Corps** = `<repo> · <ce qui s'est passé>` — le repo est omis quand il est déjà le sujet du titre.

Marqueurs d'état proposés (courts, scannables, stables — c'est ce qu'on lit en premier sur un écran
verrouillé) :

| Situation | Marqueur |
|---|---|
| `blocked` | `Needs you` |
| `done` + carte qui passe en `review` (§4) | `Review` |
| `done` sans carte | `Done` |

Rendu, sur les cas réels du snapshot :

```
AVANT                                   APRÈS
─────────────────────────────────────   ────────────────────────────────────────────────
claude is done                          Review · Auditer la pertinence des notifications
Auditer la pertinence des notifica…     collie-board · 3 fichiers, +180 −12
· Auditer la pertinence des notifi…

claude needs you                        Needs you · Mesurer la lecture des dossiers
Mesurer la lecture des dossiers et      CrewDesign · demande quel cache viser en priorité
évalu · Mesurer la lecture des doss…

claude is done                          Done · elber
worktree-green-stone-90b3 ·             ~/.herdr/worktrees/elber · 2 fichiers, +40 −3
~/.herdr/worktrees/elber/worktree-…
```

Ce que ça donne, champ par champ :

| Champ | Contenu | Source | Disponible ? |
|---|---|---|---|
| Marqueur | `Needs you` / `Review` / `Done` | `alert.status` + statut de carte (§4) | oui |
| Sujet | titre de carte, sinon repo | `alert.cardTitle`, sinon `repoName(cwd)` | oui — `cardTitle` est déjà porté par `Alert` (`notifications.ts:96`) |
| Repo (corps) | nom court du repo | `card.repoPath` ou segment de `cwd` | oui — `repoPath` déjà lu en `notify-subtitle.ts:127` |
| Quoi (corps) | sous-titre copilot → dernier message → `--stat` → rien | §3.3 | oui — cascade complète en 0.122.0 |

### 3.3 Le corps quand personne n'a réécrit : une cascade, pas un repli sur le sujet

> **Implémenté en 0.122.0** — la cascade entière est dans `enrichNotification`
> (`bridge/notify-subtitle.ts`). Le palier 3 rend le stat sur une ligne (`diffStatLine`,
> `bridge/git.ts`) et il est **récupéré indépendamment du copilot** : la condition n'est plus « le
> copilot est-il activé » mais « quelque chose l'utiliserait-il », c'est-à-dire un corps à remplir ou
> un prompt à nourrir. Le même stat sert les deux, en deux rendus — une ligne pour l'écran verrouillé,
> le listing par fichier pour le prompt — donc un seul sous-processus git par alerte, jamais zéro
> quand le corps en a besoin. Le palier 4 est déjà acquis depuis 0.121.0 (§2.2). **Deux effets de
> bord :** un `done` dont le transcript a parlé n'affiche jamais son diff (le palier 2 le prime, comme
> la cascade le prescrit), et une carte sans worktree ne déclenche plus de tour de copilot sur un
> `(no branch for this card)` — il n'y a rien à reformuler.

Le repli actuel (`cardTitle ?? cwd`) est le pire possible : il répète le sujet. Cascade proposée,
du plus informatif au moins, **sans jamais retomber sur le sujet** :

1. **sous-titre du copilot**, s'il a répondu (palier lent existant) ;
2. **dernier message de l'agent**, tronqué (palier rapide existant, aujourd'hui verrouillé — §2.3) ;
3. **`git diff --stat` résumé** pour un `done` : `3 fichiers, +180 −12`. Déjà calculé par
   `cardDiffSummary` / `cwdDiffSummary` (`notify-subtitle.ts:149-153`) mais **seulement quand le copilot
   est activé** — il sert aujourd'hui de matériau de prompt, jamais de contenu ;
4. **rien** — un corps réduit au seul repo vaut mieux qu'un corps qui répète le titre.

Le point 2 est de loin le meilleur rapport valeur/coût de tout l'audit : une lecture de fichier
déjà écrite, déjà testée, qu'un `if` mal placé empêche de s'exécuter.

### 3.4 La branche : **non** — tranché

**Décision : la branche n'entre pas dans le contenu de la notification.**

Trois arguments, dans l'ordre de force :

1. **Elle est une fonction du titre.** `branchFromTitle(card.title)` (`bridge/cards.ts:354`) slugifie
   le titre. *Vérifié en direct* : `"Auditer la pertinence des notifications et redéfinir leur
   contenu"` → `board/audit-pertinence-notifications`. Mettre les deux, c'est écrire le sujet deux
   fois — exactement le défaut qu'on corrige en §2.2.
2. **Elle n'existe que là où elle est redondante.** `withCardFields` ne pose `branch` que pour un pane
   adossé à une carte (`bridge/cards.ts:169`). Un pane lancé à la main — le seul cas où une branche
   apporterait une information non déductible — n'en a pas. *Vérifié en direct* : `branch: null` sur
   les 6 panes hors carte.
3. **Le budget d'affichage est le vrai arbitre.** Une notification push offre un titre d'une ligne et
   un corps d'une à deux lignes. Chaque caractère dépensé en branche est pris sur « ce qui s'est
   passé », qui est la seule chose que l'opérateur ne peut pas deviner.

**Où la branche a quand même sa place** : la cloche (`notification-bell.tsx`), qui est un historique
consulté sur un écran, pas un coup d'œil sur un écran verrouillé, et le détail de carte, qui
l'affiche déjà (`web/src/routes/card.tsx:431-432`). Pas le push.

### 3.5 Le digest multi-agents

> **Tranché et implémenté (corps en 0.124.0, titre en 0.126.0)** — carte N5. Le digest hérite du
> défaut de sujet en pire, et il est atteint dès la **deuxième** alerte simultanée. Les deux moitiés
> sont maintenant réparées :
>
> > **Titre** = `1 question, 2 to review` — le décompte **par état**, pas par agent
> > **Corps** = les **sujets** : `Auditer les notifications · Mesurer la lecture · elber`
>
> Le titre lit le **même marqueur** que la notification solo (`notifyMarker`, `notify-content.ts`),
> donc un `Review` isolé et un `to review` dans le digest ne peuvent pas désigner deux états
> différents. Les mots diffèrent parce que la forme diffère — « 1 Needs you » n'est pas une phrase —
> pas la règle. Un groupe vide disparaît : un troupeau homogène lit `3 to review` et ne parle pas des
> états qu'il n'a pas.

**L'ordre des groupes est fixe et le plus urgent d'abord** : `question` → `to review` → `done`. Un
agent bloqué est arrêté sur une réponse que vous seul pouvez donner ; une carte finie ne l'est pas.
Fixe et non trié par taille, sinon le titre se réordonne tout seul à chaque alerte qui se résout —
sur un écran verrouillé, un titre qui bouge est un titre qu'on relit. (L'exemple de cet audit disait
« 2 à relire, 1 question » ; c'était un rendu, pas un ordre.)

#### La coalescence est **conservée** — l'option « une notification par carte » est écartée

Le regroupement a été conçu pour éviter la pile de notifications identiques, et l'argument « chaque
notification a désormais un sujet distinct, donc la pile est lisible » ne tient pas jusqu'au bout :

1. **Un seul `tag` est aussi ce qui permet de rétracter.** `resolve()` ré-émet *le* résumé rétréci
   sur le même slot (`notifications.ts:253-265`) : traiter un agent au PC met à jour la notification
   qui reste. Avec un push par pane il faudrait un `clear` par pane, et chaque rétractation ratée
   laisserait un fantôme sur l'écran verrouillé — exactement le défaut que la coalescence corrige.
2. **Le budget d'affichage est par écran, pas par notification.** Empilées, N notifications se
   regroupent et chacune se réduit à peu près à son titre ; un digest, c'est un titre **et** un corps,
   tous deux entièrement visibles, qui portent les N sujets.
3. **Le décompte par état est une information que la pile ne porte pas.** « 1 question, 2 to review »
   se lit d'un coup d'œil ; trois notifications séparées demandent de les compter.

Décision : **on garde la coalescence.** Il n'y a donc pas de changement de posture à arbitrer, et
**pas d'ADR** — l'ADR n'aurait eu de raison d'être que pour fermer l'option inverse.

#### Le copilote sur le digest : **non** — évalué et écarté

La question posée : le copilote pourrait-il composer un sous-titre de digest, poussé en update
silencieux, comme il le fait pour une alerte solo (`enrichNotification`, palier 1) ? Aujourd'hui il
en est empêché par `currentSolo` (§2.5) : dès la deuxième alerte, toutes les réponses en vol sont
jetées. Lever cette garde a été évalué. Quatre raisons de ne pas le faire, dans l'ordre de force :

1. **Il n'y a rien à reformuler.** Le décompte par état et les sujets sont des faits que le bridge
   détient déjà, localement, gratuitement, **et de façon synchrone dans le premier push qui buzz**.
   Le copilote dépenserait du quota et des secondes pour redire moins bien ce qui est déjà écrit. Le
   palier 1 se justifie sur une alerte solo parce qu'il y traduit un `git --stat` ou un dernier
   message d'agent en une phrase — de la matière brute. Un digest n'a pas de matière brute : il a
   déjà sa phrase.
2. **Le contenu qu'il produirait n'a pas de place.** Le corps du digest porte déjà N sujets — trois
   suffisent à saturer les deux lignes d'un écran verrouillé. Ajouter « ce qui s'est passé » pour
   chacun est impossible ; le faire pour un seul, c'est choisir arbitrairement lequel des N compte.
3. **Le digest est instable, la réponse est lente.** Chaque arrivée et chaque résolution le
   re-rendent ; une réponse copilote prend des secondes à des **minutes** (file sérialisée à une
   requête, timeout 5 min — `copilot.ts:16-17,40-41`). Elle décrirait un ensemble d'alertes qui n'existe
   déjà plus. La garde `currentSolo` n'est pas un accident : un sous-titre répond à une *forme*.
4. **Le coût de quota culmine exactement là.** N agents qui finissent dans la même fenêtre, c'est le
   pic de pression sur une file d'une requête. Y ajouter un tour de digest, c'est dépenser le plus au
   moment où l'on sert le moins.

**Conséquence : la garde `currentSolo` reste telle quelle**, et elle coûte maintenant beaucoup moins
cher — ce qu'elle jette n'est plus la seule chance d'avoir un corps informatif, puisque le digest en
a un par construction. Le palier 1 reste ce qu'il est : une amélioration d'alerte solo.

*Écarté aussi, adjacent :* mémoriser la réponse copilote sur l'alerte sans la rendre, pour qu'elle
serve si le digest redescend à une seule alerte. Ça marcherait, mais ça affiche une phrase composée
plusieurs minutes plus tôt sur un pane dont on ne sait plus rien — un contenu périmé sur un slot qui
buzz. À reconsidérer seulement si quelqu'un observe le cas en vrai.

---

## Partie 4 — Règle d'événement « session terminée + carte en review »

### 4.1 La règle proposée

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

### 4.2 Pourquoi c'est réalisable sans nouvelle boucle ni nouveau hook

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

### 4.3 Les cas limites à trancher

| Cas | Comportement proposé |
|---|---|
| `done` mais la carte n'est **pas** en `review` (l'opérateur l'a bougée à la main entre-temps) | marqueur `Done`, sujet = titre de carte. On ne ment pas sur l'état. |
| `done` sans carte du tout | marqueur `Done`, sujet = repo. Inchangé. |
| Carte en `review` alors que le pane est reparti en `working` | pas de notification — `resolve()` a déjà rétracté (`notifications.ts:130-134`). Correct. |
| `done` sur une **sous-tâche** dont le conteneur passe aussi en `review` (`cards.ts:60`) | notifier la sous-tâche, jamais le conteneur. Le conteneur n'a pas de pane et son passage en `review` est dérivé (`cards.ts:277-283`) — le notifier ferait deux alertes pour un événement. |
| La carte passe en `review` **sans** transition de pane (ex. relance de review manuelle) | hors périmètre de cette règle : c'est une notification d'événement de board, pas de session (carte N6). |

### 4.4 Ce que cette règle ne couvre pas

Elle reste attachée à une transition de **pane**. Les événements purement board — carte orpheline,
review du copilot rendue, dépendance débloquée — n'ont toujours aucun canal. C'est une extension
naturelle une fois cette règle en place, mais c'est un autre chantier (carte N6), et il demandera de
décider si le board a le droit d'émettre des notifications de son propre chef.

> **Tranché le 2026-08-26 en [§6](#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)** :
> le board a ce droit, sous trois tests et une condition de rétraction, sans second canal. Le cas
> laissé ouvert dans le tableau ci-dessus — une carte qui entre en `review` sans transition de pane —
> y est recensé sous **B12**.

---

## Partie 5 — Cartes à créer

Ordonnées par rapport valeur/coût. **Aucun code n'est écrit dans le cadre de la carte d'audit.**

### N1 — Libérer le palier gratuit du sous-titre de la préférence copilot — ✅ fait en 0.120.0

**Pourquoi** : §2.3. C'est un `if` mal placé (`bridge/index.ts:201`) qui empêche une lecture de
transcript déjà écrite et testée de s'exécuter. Sans copilot, sans quota, sans réseau.
**Portée** : séparer la garde en deux — le palier rapide sous sa propre condition (transcripts
disponibles), le palier copilot sous `copilotSubtitle`. Renommer la préférence en conséquence ou en
ajouter une seconde ; c'est le seul vrai arbitrage de la carte.
**Acceptation** : avec `copilotSubtitle` off et le copilot off, une alerte `blocked` porte le dernier
message de l'agent dans son corps. La préférence `copilotSubtitle` ne gouverne plus que le copilot.

### N2 — Changer le sujet du titre et sortir le repo du corps — ✅ fait en 0.121.0

**Pourquoi** : §2.1, §2.2, §3.2. Le titre est un discriminant nul et le corps est une redondance.
**Portée** : réécrire `NotificationCoordinator.summarize` (forme A) selon §3.2 ; dériver le repo de
`card.repoPath` ou de `cwd` plutôt que de faire confiance à `workspaceLabel` ; porter `repoPath` sur
`Alert` si nécessaire. La branche est explicitement exclue (§3.4).
**Acceptation** : deux alertes de deux cartes différentes ont deux titres différents ; le repo
apparaît exactement une fois ; aucun champ n'est répété entre titre et corps.

### N3 — La cascade de repli du corps — ✅ fait en 0.122.0

**Pourquoi** : §3.3. Le repli actuel répète le sujet ; le `--stat` est calculé puis jeté.
**Portée** : implémenter la cascade sous-titre → dernier message → `--stat` → rien, et calculer le
`--stat` indépendamment de l'activation du copilot. Dépend de N1 et N2.
**Acceptation** : une alerte `done` sur une carte, copilot off, porte un résumé de diff dans son
corps. Aucun cas ne retombe sur le titre de la carte.

### N4 — La notification porte sur la carte en review — ✅ fait en 0.125.0

**Pourquoi** : Partie 4. C'est la demande d'origine sur l'événement notifié.
**Portée** : *revue après N3 — plus petite qu'écrite ici à l'origine.* Le marqueur ne se compose plus
à la main : depuis N2 il vit dans `notifyContent` (`bridge/notify-content.ts`), où `Review` est **une
ligne**. La carte est déjà chargée au moment de `onFire` (`notify-subtitle.ts:139` — la référence
`:127` d'origine a bougé avec la cascade), et `BoardDb.getCard` rend la carte entière : `status` est
donc là, il suffit d'élargir le type narrowé de `EnrichOpts.board` (`notify-subtitle.ts:92`), qui ne
déclare aujourd'hui que `{ title, spec }`. **Le vrai reste du travail est le tap** : faire pointer la
destination vers la carte plutôt que vers le pane, ce qui demande un champ dans le payload push à côté
du `target: "settings"` existant (`push.ts:64-66`, `sw.ts:100-103`). Traiter les cas limites de §4.3.
Dépend de N2.
**Revue après N9 (0.124.0)** : le marqueur profite désormais aux **trois** surfaces d'un coup — mais
`notify-content.ts` existe en double (bridge + web), et l'écrire d'un seul côté casse le build ; la
ligne s'écrit une fois puis se copie. En regard, le **tap s'agrandit** : le toast et la cloche
deep-linkent encore vers le pane (`panePath`), donc sans elles deux surfaces sur trois diraient
`Review` et ouvriraient le terminal — le défaut déplacé, pas corrigé.
**Acceptation** : une session qui se termine sur une carte qui passe en `review` produit une
notification dont le marqueur est `Review` et dont le tap ouvre la carte, sur les trois surfaces. Une
session qui se termine sans carte est inchangée.
**Livré** : `notifyContent` lit un `cardStatus` (une ligne pour le marqueur) et `notifyCardId` en
dérive la destination — une seule condition, donc le marqueur et le tap ne peuvent pas diverger. Le
statut arrive par le hook de pré-tir du coordinateur, élargi de `subtitleFor` à `beforeFire`
(`{ subtitle, cardStatus }`) : c'est le seul instant où la carte est déjà réconciliée (§4.2). Les
surfaces in-app le lisent directement sur le snapshot (`withCardFields` porte `cardStatus` sur
`AgentView`), le push par un `cardId` à côté du `target` existant. Aucune boucle, aucun hook nouveau,
une lecture DB par alerte **tirée**.

### N5 — Instruire le digest multi-agents (et le principe même de la coalescence) — ✅ livrée

> **Fait, en 0.126.0.** Arbitrage rendu en [§3.5](#35-le-digest-multi-agents) : **on garde la
> coalescence** (donc pas d'ADR — il n'avait de raison d'être que pour fermer l'option inverse) et on
> enrichit le digest. Titre = décompte par état lu du même `notifyMarker` que la notification solo
> (`1 question, 2 to review`), corps = les sujets (déjà acquis en 0.124.0). Le passage du copilote
> sur le digest est évalué et **écarté** : le digest n'a pas de matière brute à reformuler, pas de
> place pour le résultat, et sa composition change plus vite qu'une réponse ne revient. La garde
> `currentSolo` (§2.5) reste donc telle quelle.

**Pourquoi** : §2.5, §3.5. Le digest est le pire contenu émis, il est atteint dès la deuxième alerte,
et il annule tous les sous-titres en vol.
**Portée** : audit ciblé + décision. Deux options à comparer : améliorer le digest (décompte par
état + sujets), ou abandonner la coalescence maintenant que chaque notification a un sujet distinct.
La seconde est un changement de posture et mérite un ADR. **Pas d'implémentation avant l'arbitrage.**
**Acceptation** : une décision écrite, avec son ADR si l'option 2 est retenue.

### N6 — Le board comme source d'événements notifiables — ✅ arbitrage rendu, [§6](#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)

> **Rendu le 2026-08-26.** Le board **a** le droit d'émettre, sous trois tests (le fait n'a pas été
> demandé à l'instant · il ouvre une action · aucun pane ne le dit déjà) et une condition (savoir
> comment il se rétracte), dans le **même** slot, digest, snooze et jeu de préférences que le reste.
> Douze événements recensés en [§6.3](#63-le-recensement) : cinq retenus pour le push (B1, B2, B4,
> B5, B12), deux pour la cloche seule (B7, B10), cinq écartés — dont un pour une raison structurelle
> ([§6.5](#65-ce-qui-reste-hors-datteinte-et-pourquoi-ce-nest-pas-un-manque-de-courage)). Le
> déclencheur commun existe déjà et n'est pas une boucle : le journal `event` tailé sur `onUpdate`
> ([§6.2](#62-le-déclencheur-commun-existe-déjà-et-ce-nest-pas-une-boucle--le-journal)).

**Pourquoi** : §1.1, §4.4. Aujourd'hui seuls les statuts de pane sont observés. Une carte orpheline,
une review du copilot rendue, une dépendance débloquée ne notifient rien.
**Portée** : recensement des événements de board qui mériteraient une notification, et arbitrage sur
le droit du board à en émettre (contrainte `CLAUDE.md` : pas de nouvelle boucle — tout doit
s'accrocher à `engine.onUpdate`). Brainstorm, pas implémentation.
**Acceptation** : une liste d'événements candidats, chacun avec son déclencheur existant et son coût.

### N7 — Sortir le sous-titre de la file du copilot, ou lui donner la priorité — ⚠️ largement dissoute

> **Revue après N1, N3 et N10 : sa prémisse a disparu.** §2.4 la justifiait par « le tour court dont
> la valeur se périme attend derrière le tour long ». Or la notification n'attend plus le copilot du
> tout : le palier gratuit rend dès qu'il est lu (N1), la cascade descend au `--stat` quand il n'y a
> pas de transcript (N3), et le premier push part complet (N10). Ce qui périssait ne périt plus — la
> reformulation du copilot est devenue un **bonus dont le retard ne coûte rien**.

**Ce qu'il reste, et c'est mince** : la seule question encore ouverte est de savoir si la polish du
copilot doit arriver **avant que l'opérateur ait traité le pane**, faute de quoi le garde-fou de
fraîcheur (`currentSolo`) la jette. Ce n'est plus « l'alerte est plate », c'est « l'alerte aurait pu
être mieux tournée ». Priorité basse, et à ne rouvrir que si un usage réel montre que la polish est
jetée souvent.
**Portée si on la reprend** : soit une priorité dans `Copilot.ask` (`copilot.ts:793-798`), soit un
budget de temps propre au sous-titre au-delà duquel il abandonne. À arbitrer contre la règle « le
copilot est sérialisé à une requête » (`CLAUDE.md`, §The board) — qui n'interdit pas un ordre,
seulement un parallélisme.
**Acceptation** : quand une carte atterrit, le sous-titre de notification passe avant la review de
cette même carte.

### N8 — Renseigner `sessionName` avant les listeners de transition

**Pourquoi** : §2.6, *mais la cible a changé depuis N2*. La raison d'origine était « le push est moins
riche que le toast sur le même événement ». Ce n'est plus vrai du push : N2 a sorti `paneDisplayName`
du titre, qui vaut désormais `<marqueur> · <sujet>`. Le seul survivant est `notifications.ts:244`, la
branche **digest multi-agents** — et la cloche, qui compose encore de son côté (N9). Le symptôme
restant est donc : un pane renommé par `/rename` n'apparaît pas sous ce nom dans un digest ni dans
l'historique. Correctif inchangé ; ne pas le chercher sur une alerte seule, il n'y est plus.
**Portée** : appliquer le cache `sessionNames` dans `toView` (`state-engine.ts:203-230`) plutôt
qu'après la boucle de transitions. Correctif de quelques lignes ; sans effet visible tant que
personne n'utilise `/rename`, ce qui en fait une carte de faible priorité mais de coût quasi nul.
**Acceptation** : un pane dont le nom `/rename` était connu au poll précédent porte ce nom dans
l'`Alert` de sa transition suivante.
**Depuis N9 (0.124.0) : plus aucun symptôme.** Le digest liste les sujets et la cloche compose comme
le push — aucune surface ne nomme plus le pane, donc `sessionName` n'est lu par aucune notification.
Les ingrédients de rename restent portés par l'entrée d'historique (`notify-log.ts`) sans lecteur. À
fermer, ou à rouvrir seulement le jour où une surface redonne un rôle au nom du pane.

### N9 — Une seule composition de contenu pour les trois surfaces — ✅ fait en 0.124.0

> **Fait.** `notifyContent()` compose le push, le toast et la cloche. Pas par un import — le web se
> construit indépendamment de l'arbre du serveur Bun, contrainte assumée du dépôt (en-tête de
> `web/src/lib/types.ts`) — mais par une copie **octet pour octet** que `notify-content.test.ts`
> vérifie, ce qui fait tenir l'acceptation malgré le doublon : éditer un fichier sans copier l'autre
> casse le build. `notifyVerb`/`notifyWhere`/`notifyWhat` sont supprimés : ils distribuaient les mots
> d'une phrase que chaque appelant réassemblait. Le doublon délibéré de `paneDisplayName`
> (`bridge/types.ts:80`) reste — c'est le même arbitrage, désormais outillé. Le corps du digest liste
> les sujets dédupliqués ; son titre compte par état depuis 0.126.0 (§3.5, carte N5).

**Pourquoi** : §1.3, C7. Trois codes composent le même contenu à trois niveaux de richesse, et une
amélioration de l'un ne profite pas aux autres. Les helpers `notifyVerb`/`notifyWhere`/`notifyWhat`
(`web/src/lib/types.ts:80-104`) sont la bonne forme, mais ils vivent côté web et le push ne les voit
pas.
**Portée** : après N2/N3/N4, factoriser la composition dans le bridge et la faire consommer par les
trois surfaces. Attention à la contrainte `paneDisplayName` déjà dupliquée volontairement
(`bridge/types.ts:80-82`) : cette carte est aussi l'occasion de trancher si ce doublon reste
délibéré.
**Acceptation** : une amélioration du contenu ne se code qu'une fois.

### N10 — Un seul push, complet : ne différer que ce qui est lent — ✅ fait en 0.123.0

**Pourquoi** : *découvert en vérifiant N3 sur l'appareil, pas à la lecture du code.* Une alerte part
aujourd'hui en deux messages : l'alerte initiale, vide et **vibrante** (`renotify: true`), puis la mise
à jour de sous-titre, complète et **silencieuse** (`renotify: false`). Les deux partagent le collapse
topic `collie-herd` (`SEND_OPTIONS`, `bridge/push.ts:27`), et un collapse topic veut dire : *si
l'appareil est injoignable, ne garder que le dernier*. Un téléphone endormi ne reçoit donc que le
second — le silencieux. L'alerte se pose sans vibration, précisément dans le cas où le push existe :
écran éteint, appareil dans la poche.

*Mesuré en direct* (0.122.0, 3 abonnements — 1 FCM, 2 Mozilla) : les 6 envois d'une alerte à deux
temps repartent tous en `201`, et la notification atteint le téléphone **environ une minute plus
tard, sans vibration**. Un message unique à `renotify: true` envoyé seul, lui, vibre.

**Mais le collapse n'est pas la cause — c'est le découpage qui ne se justifie pas.** Les coûts, tous
mesurés :

| Étape | Coût |
|---|---|
| Debounce avant que l'alerte parte | **30 000 ms** (`notifyDelayMs`, défaut) |
| Palier 2 — lecture du transcript | 1–60 ms (`context.ts:55-56`) |
| Palier 3 — `git --stat` | ~20 ms (mesuré sur une carte réelle, 10 fichiers) |
| Palier 1 — le copilot | secondes à minutes, sérialisé sur tout le board |

L'alerte attend **déjà 30 secondes**. Lui ajouter ~80 ms pour qu'elle parte complète plutôt que vide,
c'est 0,3 % de retard en plus. Le découpage en deux temps n'a donc qu'une seule vraie justification :
le copilot, seul palier réellement lent. Pour les paliers 2 et 3 il ne rachète rien et coûte un
message, une vibration, et la machinerie de fraîcheur qui va avec.

**Portée** : le **premier** push attend les paliers 2 et 3 et part complet. La mise à jour silencieuse
ne subsiste que pour le copilot — de l'information supplémentaire qui arrive après, sur une alerte
déjà lisible : c'est là que le deuxième temps est cohérent, et là seulement. Le copilot étant éteint
par défaut, la configuration par défaut n'envoie plus qu'**un seul message**, qui vibre toujours, et
le défaut ci-dessus disparaît sans avoir à arbitrer les collapse topics.

Deux points d'attention :

- `NotificationCoordinator.emit()` est synchrone et `notifications.ts` est un fichier d'upstream. Le
  faire attendre y touche plus profondément qu'un hook. La contrainte de surface upstream est un coût
  de rebase, pas un principe : elle ne pèse que si le fork tire encore d'upstream — à trancher, et à
  écrire, avant de s'en affranchir ici. *Tranché à la livraison* : dépense assumée sur ce point précis,
  inscrite dans [`UPSTREAM.md`](./UPSTREAM.md) comme les autres entrées — pas d'ADR, ce n'est pas une
  levée générale de la contrainte. La brique 24 du ledger porte la facture d'extraction correspondante.
- Une lecture de transcript ou un sous-processus git qui pend ne doit **jamais** retarder l'alerte :
  ce qu'on attend, on l'attend sous délai borné, et on part sans lui à l'expiration. Le corps vide
  reste un repli acceptable (§3.3, palier 4) ; une alerte qui n'arrive pas, non.

**Acceptation** : copilot éteint, une alerte survenue pendant que le téléphone dort arrive en **un
seul message**, complet et vibrant. Vérifiée sur l'appareil, écran verrouillé — le seul juge, comme
pour les troncatures.

*Livré en 0.123.0.* Le coordinateur attend `subtitleFor` avant de rendre ; les paliers 2 et 3 sont
`firstSubtitle`, sous une borne de 1 500 ms. Coûts re-mesurés à la livraison : `git --stat` sur un
dépôt sale réel **12 ms**, palier 2 sur le pire transcript de la machine (34 Mo) **220 ms** — la
borne n'est atteinte que par du travail bloqué. Copilot éteint = **un seul message**, `renotify:true`.

---

## Partie 6 — Le board comme source d'événements notifiables (carte N6)

> Rendu le 2026-08-26 sur la branche `board/n6-le-board-comme-source-d-evenements-notifiable`.
> **Recensement et arbitrage. Rien n'est implémenté ici**, et aucune boucle n'est proposée (contrainte
> dure, `CLAUDE.md` §The board).

### 6.1 L'arbitrage : oui, sous trois tests et une condition

La décision d'abord, l'argument ensuite.

> **Le board a le droit d'émettre des notifications de son propre chef.** Rien ne justifie de réserver
> la notification aux transitions de pane : le pane n'est pas ce que l'opérateur suit, c'est
> l'instrument. Ce que le board sait et que le pane ignore — une carte devenue relançable, un verdict
> rendu, un handoff qui n'a jamais abouti — est exactement ce qu'on rouvre l'application pour aller
> chercher.
>
> **Mais il n'émet rien qui ne passe les trois tests ci-dessous, il ne crée aucun second canal, et un
> fait sans règle de rétraction n'émet pas du tout.**

**Test 1 — le fait est-il arrivé sans que l'opérateur le demande à l'instant ?**
C'est le test qui élimine le plus de candidats, et c'est le bon : `integrate.ts:5` le dit déjà pour
ses cinq gestes — « all five are TAPS ». Un merge, un PR, un démarrage sont awaités par leur route
(`board-routes.ts:569`, `:851-853`) : la réponse HTTP **est** la notification, l'opérateur a le doigt
dessus, et un push par-dessus est du bruit. Ne passent ce test que les faits dont la queue est
asynchrone et dépasse largement le tap qui les a lancés (une review, un handoff, un nettoyage
automatique), et ceux que personne n'a demandés du tout (un orphelinat).

**Test 2 — le fait ouvre-t-il une action, ou raconte-t-il seulement ?**
« La carte est passée en `working` » est du journal. « La worktree n'a pas pu être supprimée » est une
décision qui attend. Le journal des cartes (`db.recordEvent`, `db.ts:1218`) existe précisément pour
tout le reste, et il est déjà rendu sur l'écran de carte : un fait qui n'ouvre rien y reste.

**Test 3 — un pane le dit-il déjà ?**
C'est la règle que N4 a appliquée sans la nommer : la carte qui entre en `review` n'a pas sa propre
notification de board, elle est portée par la transition `done` du pane qui l'y a mise. Un événement
de board ne notifie que ce qu'aucun pane n'a signalé — sinon le même fait buzze deux fois, par deux
chemins qui n'ont aucun moyen de savoir l'un pour l'autre.

**La condition, et c'est la plus structurante : un événement de board doit dire comment il se
rétracte.**
Toute la machinerie de `NotificationCoordinator` repose sur des alertes **réversibles** : une alerte
de pane s'efface parce que le pane change d'état (`notifications.ts:130-134`, `:163-165`). Un
événement de board est **ponctuel** : `review.created` est vrai une fois et ne redevient jamais faux.
Coalescé tel quel dans le slot du troupeau, il y resterait à vie — et le digest annoncerait « 1 to
review » pour une carte lue il y a trois jours. **Donc : un événement de board ne rejoint le slot que
s'il est accompagné d'un prédicat de rétraction lisible sur la carte** (« la carte a quitté `review` »,
« la carte a été ouverte », « la carte n'est plus `orphaned` ») — évalué au même endroit que le reste,
sur `onUpdate`. Un fait dont on ne sait pas dire quand il cesse d'être vrai ne notifie pas ; il va au
journal, ou à la cloche, qui est une histoire et non un état.

**Et : pas de second système.** Les événements de board entrent dans le **même** slot `collie:herd`,
le **même** digest, le **même** snooze, les **mêmes** préférences (`notify-prefs.ts:31-36`). La
tentation inverse — un tag `collie:board`, une catégorie « alerte board » — donnerait deux endroits où
couper le son et deux notifications simultanées pour un troupeau qui n'en veut qu'une. Le seul
assouplissement admis est **par surface** (§6.3, B7 et B10) : certains faits méritent la cloche et pas
la vibration, et les trois surfaces sont déjà séparables depuis N9.

### 6.2 Le déclencheur commun existe déjà, et ce n'est pas une boucle : le journal

Presque tout ce que la Partie 5 appelait « un chantier » est **déjà écrit dans la base**. La table
`event` (`db.ts:478-485`) est un journal append-only à clé primaire auto-incrémentée, et 33 types y
sont posés aujourd'hui par tous les chemins confondus — poll, route HTTP, copilot :

```
card.agent_adopted · card.cleaned_up · card.cleanup_failed · card.created · card.discarded
card.edited · card.merge_failed · card.merged · card.pr_failed · card.pr_opened · card.prompted
card.resolve_requested · card.split_from · card.start_failed · card.status · card.worktree
copilot.explained · copilot.explain_failed · copilot.refined · copilot.refine_failed
copilot.reformulated · copilot.reformulate_failed · copilot.review_failed · copilot.split_kept
handoff.completed · handoff.expired · handoff.failed · handoff.requested
review.created · session.closed · session.opened · wrapup.collected · wrapup.expired · wrapup.failed
```

Le déclencheur unique de toute la Partie 6 tient donc en une phrase : **un consommateur accroché à
`engine.onUpdate` (session primaire, comme `reconcile`, `ContextTracker`, `HandoffCoordinator`,
`WrapupCoordinator` et `CopilotCoordinator` — `index.ts:280-308`) qui fait
`SELECT … FROM event WHERE id > ?` avec un curseur en mémoire.**

Pourquoi c'est bon marché, point par point :

| | |
|---|---|
| **Nouvelle boucle** | Aucune. C'est le sixième `engine.onUpdate` d'une liste qui en compte déjà cinq. |
| **Coût par tick** | Une requête de plage sur la clé primaire (`WHERE id > ?` = un parcours du rowid) qui rend zéro ligne dans le cas normal. Moins cher que `reconcile()`, qui interroge déjà `listOpenSessions` + `childStatusesByParent` à chaque tick. |
| **Curseur** | Initialisé au dernier `id` au démarrage, en mémoire. Un restart ne rejoue donc pas le passé — même posture que `NotifyLog` et `CopilotCoordinator.busyCards` : runtime, non persisté (`CLAUDE.md` §The board). |
| **Ratés** | Impossible de manquer un fait entre deux polls, contrairement à un diff de snapshots : le journal est écrit par l'action, pas dérivé d'un état. |
| **Snapshot `disconnected`** | Sans objet — le tailer ne lit pas le snapshot, et `onUpdate` n'est de toute façon appelé qu'après un poll réussi (`state-engine.ts:306-309` : le `catch` sort avant). Les gardes des autres consommateurs restent, elles, nécessaires : elles protègent des lectures de snapshot. |
| **Surface upstream** | Un fichier neuf (`bridge/board-notify.ts`), un `engine.onUpdate` de plus dans `index.ts`. `notifications.ts` n'est touché que si l'on veut la coalescence (§6.4). |

Le tailer ne décide de rien : il ramasse tout, et ce sont les trois tests de §6.1 qui filtrent. Un
`card.merged` passera par lui et sera jeté — c'est normal, le filtre est le fait, pas le déclencheur.

### 6.3 Le recensement

Colonnes : ce qui se passe · où c'est déjà écrit · ce que ça ouvre comme action · comment ça se
rétracte · ce que ça coûte en plus du socle (§6.4) · verdict.

| # | Événement | Déclencheur **existant** | Action ouverte | Rétraction | Coût propre | Verdict |
|---|---|---|---|---|---|---|
| **B1** | **Carte orpheline** — son pane a disparu du snapshot | `reconcile()` sur `onUpdate` → `card.status {to: "orphaned"}` (`cards.ts:260-261`) | relancer depuis le dernier handoff | la carte quitte `orphaned` | nul — le tailer suffit | **oui**, mais voir la note de masse |
| **B2** | **Review du copilot rendue** | `CopilotCoordinator.review()` → `db.createReview` (`copilot.ts:1391`) → `review.created {reviewId, verdict}` | lire le verdict, les notes, les follow-ups | la carte quitte `review`/`done`, ou est ouverte | nul ; le verdict est déjà dans le payload | **oui** — le meilleur candidat du lot |
| **B3** | **Follow-ups créés par la review** | même chemin → `card.created` avec `origin: "copilot"` (`copilot.ts:1363-1389`) | trier le backlog | — | — | **non séparément** : un décompte dans le corps de B2, jamais N cartes = N buzz |
| **B4** | **Dépendance débloquée** — le prédécesseur est `done`/`archived`, le successeur devient démarrable | `card.status {to: "done"\|"archived"}` + `WHERE depends_on = ?` (la gate est `cards.ts:626-636`) | **démarrer** la carte | la carte démarre ou quitte `ready`/`backlog` | une requête non indexée sur `card`, seulement sur un `to: done`/`archived` (rare) | **oui**, marqueur propre, **off par défaut** |
| **B5** | **Handoff échoué ou expiré** | `HandoffCoordinator.update` sur `onUpdate` → `handoff.failed` / `handoff.expired` (`handoff.ts:166`, `:191`, `:234`) | reprendre à la main — sinon la carte garde une session morte et personne ne le sait | la carte redevient live, ou est ouverte | nul | **oui** — un échec silencieux est ce qu'une notification sert le mieux |
| **B6** | **Wrapup expiré ou échoué** | `WrapupCoordinator` sur `onUpdate` → `wrapup.expired` / `wrapup.failed` (`wrapup.ts:167`, `:200`) | aucune : il manque une note de clôture, le nettoyage a suivi quand même | — | — | **non** — échoue au test 2 |
| **B7** | **Nettoyage automatique refusé** — worktree ou branche restée | `WrapupCoordinator.autoCleanup` → `cleanupCard` → `card.cleanup_failed` (`wrapup.ts:214-218`, `integrate.ts:365`, `:373`, `:382`) | décider : merger, pousser, ou jeter | ne se périme pas | nul | **cloche oui, push non** — c'est « il reste quelque chose sur ton disque », pas une urgence |
| **B8** | **Merge / PR terminés ou échoués** | routes awaitées (`board-routes.ts:851-853`) → `card.merged`, `card.pr_opened`, `card.merge_failed`, `card.pr_failed` | — | — | — | **non** — test 1 : la réponse HTTP est déjà la notification |
| **B9** | **PR mergée ou fermée sur GitHub par quelqu'un d'autre** | **aucun** — `prStatusFor` n'est lu qu'à l'ouverture de la carte, TTL 60 s, un `gh` par lecture (`integrate.ts:117-126`) | relire, nettoyer | — | **un poll réseau** | **non, et c'est structurel** (§6.5) |
| **B10** | **Échec d'une demande copilot** — `copilot.refine_failed`, `explain_failed`, `reformulate_failed`, `review_failed` | les chemins copilot, tous asynchrones (`copilot.ts:1033`, `:1137`, `:1158`, `:1342`) | re-demander | — | nul | **cloche oui, push non** — un tap dont on n'apprend jamais qu'il n'a rien produit |
| **B11** | **Démarrage de carte échoué** | `card.start_failed` — mais `startCard` est awaité par la route (`board-routes.ts:569`) | — | — | — | **non** — test 1 ; à rouvrir seulement si le start devient asynchrone |
| **B12** | **Carte entrée en `review` sans transition de pane** (le cas laissé ouvert par §4.3) | `card.status {to: "review"}` hors `reconcile` | relire | la carte quitte `review` | nul | **oui**, et c'est le complément exact de N4 : même marqueur, même destination, autre déclencheur |

**Note de masse sur B1.** Un herdr redémarré fait disparaître tous les panes d'un coup : `reconcile()`
orpheline alors *tout le board* dans le même tick. C'est le risque n°1 de cette catégorie, et la
coalescence existante l'absorbe déjà (« 4 orphaned » plutôt que quatre notifications) **à condition
que B1 entre dans le slot du troupeau** — ce qui est précisément la position de §6.1. À noter aussi :
la disparition du pane rétracte au même moment l'alerte de pane qui portait dessus
(`notifications.ts:163-165`), donc l'ancienne alerte s'efface et la nouvelle arrive — c'est le bon
comportement, mais c'est un aller-retour dans un même tick qu'il faudra regarder sur l'appareil.

**Note de doublon sur B2.** Copilot actif, une carte qui atterrit produit déjà l'alerte `Review` de N4
trente secondes après la fin de session ; la review arrive minutes plus tard. Ce ne sont pas les mêmes
faits (« à relire » vs « le copilot a un avis dessus »), mais ça ferait deux buzz pour une carte. La
sortie existe déjà et ne demande rien de neuf : **si l'alerte de la carte est encore en cours, la
review l'enrichit silencieusement** — exactement ce que fait le sous-titre du copilot via
`currentSolo` (`notifications.ts:221-223`, §2.5) — **et elle ne buzze de son propre chef que si cette
alerte a déjà été rétractée**. Un seul cas la fait exister seule, et c'est le bon : la carte a été
lue, puis le verdict est tombé.

**Note de priorité sur B4.** C'est le seul événement de la liste qui **ouvre** une possibilité au lieu
d'en réclamer une, et la gate est explicitement « pas un déclencheur » (`cards.ts:626`) : rien ne doit
démarrer tout seul. Donc marqueur distinct (`Ready`, jamais `Needs you`) et préférence **off par
défaut**, dans la même logique que `done` (§2.7). Le cas « l'opérateur est justement devant le board »
est déjà couvert sans rien coder : le service worker supprime le push quand un onglet est visible
(`push-decision.ts:63`).

### 6.4 Le socle partagé : ce que ça coûte vraiment

Le tailer est trivial ; le prix est ailleurs, et il faut le dire honnêtement. **Le pipeline de
notification est indexé par `paneId` de bout en bout.**

| Point | État aujourd'hui | Ce qu'un événement de board demande |
|---|---|---|
| Clé d'alerte | `pending` et `outstanding` sont des `Map<paneId, …>` (`notifications.ts:154-156`) | une clé opaque — `card:<id>` — le coordinateur n'a jamais besoin qu'elle soit un pane |
| Type d'alerte | `Alert.status` vaut `"blocked" \| "done"` ; `FiredAlert.paneId` est **requis** (`notifications.ts:92`, `:122`) | élargir le statut, rendre `paneId` optionnel |
| Historique | `NotifyLogEntry.paneId` requis, et `enrich()` matche dessus (`notify-log.ts:20`, `:93-96`) | même élargissement ; la cloche route **déjà** vers une carte quand il y en a une (`notification-bell.tsx:145`) — c'est une ligne |
| Marqueur | `notifyMarker` ne connaît que `blocked`/`done`+`review` (`notify-content.ts:88-90`) | une entrée par nouveau marqueur, **dans les deux copies** du fichier (bridge + web, diffées par un test) |
| Digest | `DIGEST_COUNTS` compte par marqueur (`notifications.ts:134-138`) | une ligne par nouveau marqueur, dans l'ordre d'urgence |
| Préférences | quatre booléens (`notify-prefs.ts:31-36`) | un booléen par famille — **pas un par événement**, ou l'écran de réglages devient la liste de §6.3 |
| Rétraction | `resolve()` est appelé par une transition ou une disparition de pane | le prédicat de §6.1, évalué sur `onUpdate` à côté du tailer |

Deux remarques de posture :

- `notifications.ts` est un **fichier upstream**. N10 y a déjà dépensé une modification profonde,
  assumée et inscrite dans [`UPSTREAM.md`](./UPSTREAM.md). Élargir la clé et le type d'alerte est une
  dépense du même ordre — à décider consciemment, avec le ledger [`UPSTREAM_PRS.md`](./UPSTREAM_PRS.md)
  en regard : « un coordinateur de notifications qui ne présume pas que ses alertes sont des panes »
  est une brique **générique**, donc elle y a sa place.
- Une sortie moins chère existe et mérite d'être posée : **ne servir d'abord que la cloche**.
  `NotifyLog.add()` est appelable directement (`index.ts:225` le fait déjà depuis le hook `onFire`) et
  ne traverse ni le coordinateur, ni le débounce, ni la coalescence. B7, B10 et une première version de
  B2 y tiennent sans toucher une ligne d'upstream, sans prédicat de rétraction (une histoire ne se
  rétracte pas), et sans risque de réveiller un téléphone pour rien. **C'est la version à livrer en
  premier** ; le push est l'incrément d'après, pour les seuls B1, B2, B5 et B12.

### 6.5 Ce qui reste hors d'atteinte, et pourquoi ce n'est pas un manque de courage

**B9 est le seul événement réellement extérieur de tout le board**, et le seul dont le déclencheur
n'existe pas : l'état d'une PR ne se lit qu'en appelant `gh`, `prStatusFor` ne le fait qu'à l'ouverture
de la carte, et le détecter en continu serait un poll réseau — interdit par la contrainte dure. Le
tailer ne peut rien pour lui : GitHub n'écrit pas dans notre journal. La seule ouverture honnête est un
**webhook** (un événement entrant, pas une boucle), ce qui suppose une porte d'entrée ; or Collie n'en
gère qu'une, `tailscale serve`, et [ADR 0001](./.adr/0001-one-managed-front-door.md) ferme cette
discussion. **Donc : non, et ça le reste tant que la posture d'ingress ne change pas.**

Deux autres non-décisions, assumées :

- **Aucun ADR n'est écrit pour §6.1.** Un ADR ferme une option qu'on reproposera ; ici l'arbitrage
  *ouvre* — il autorise le board à émettre. Ce qui mériterait un ADR est l'inverse (« le board ne
  notifie jamais »), et ce n'est pas ce qui est tranché. La règle de §6.1, si elle est implémentée, a
  sa place en trois lignes dans `CLAUDE.md` §The board, à côté de « pas de nouvelle boucle ».
- **Le prédicat de rétraction n'est pas spécifié événement par événement.** La colonne « Rétraction »
  de §6.3 en donne l'intention ; sa forme exacte (lue sur la carte à chaque tick, ou armée une fois et
  vérifiée à l'affichage) est un choix d'implémentation qui appartient à la carte qui le fera.

### 6.6 L'ordre, si on implémente

Valeur décroissante par unité de code, et chaque étape est livrable seule :

1. **La cloche seule** — B2, B7, B10 via `NotifyLog.add()` + le tailer. Zéro fichier upstream touché,
   zéro rétraction à définir. C'est déjà « le board raconte ce qui s'est passé pendant votre absence ».
2. **B1 et B5 en push** — les deux faits que personne n'a demandés et que rien d'autre ne dit. Demande
   le socle de §6.4 (clé d'alerte, `paneId` optionnel, un marqueur, une ligne de digest).
3. **B12** — le complément de N4, gratuit une fois le socle posé : même marqueur, même destination.
4. **B4** — off par défaut, marqueur `Ready`. À faire en dernier : c'est la seule notification agréable
   du lot, et une notification agréable est celle qu'on regrette le moins de ne pas avoir.

---

## Ce que cet audit ne tranche pas

- **Le défaut de `NotifyPrefs.done`** (§2.7). À reconsidérer une fois N1 à N4 livrées, pas avant :
  aujourd'hui le défaut `off` est le bon réglage pour le contenu actuel.
- ~~**La coalescence** (N5). Assumée comme un acquis par le code actuel ; l'audit constate qu'elle
  coûte cher et laisse l'arbitrage à sa propre carte.~~ **Tranchée en 0.126.0 : conservée** (§3.5).
- **La longueur exacte des troncatures** par plateforme. Les propositions de §3.2 visent « court »
  sans chiffrer ; un passage sur un vrai téléphone est le seul juge.
