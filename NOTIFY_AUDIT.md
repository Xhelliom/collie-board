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

Le digest actuel (`3 agents done` / `claude, claude, claude`) hérite du même défaut de sujet, en
pire. Proposition, à confirmer par un essai plutôt que décidée ici :

> **Titre** = `2 à relire, 1 question` (le décompte par état, pas par agent)
> **Corps** = les **sujets**, pas les noms : `Auditer les notifications · Mesurer la lecture · elber`

Et une question ouverte, à instruire séparément (voir carte N5) : faut-il vraiment coalescer ?
Le regroupement a été conçu pour éviter la pile de notifications identiques — un problème qui
disparaît en grande partie si chaque notification a un sujet distinct. Une notification par carte,
avec un `tag` par pane, pourrait être meilleure que le digest **une fois le contenu réparé**. C'est
un changement de posture, pas un réglage : il mérite son propre arbitrage et probablement un ADR.

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
`opts.board.getCard(alert.cardId)` (`notify-subtitle.ts:127`) — mais n'en garde que le `title` et le
`spec`, pour le prompt du copilot. **Le statut de la carte est déjà chargé au bon moment, et jeté.**

Il n'y a donc ni poll à ajouter (interdit par `CLAUDE.md`, §The board), ni hook à créer : il faut
lire un champ de plus sur un objet déjà en main, au moment où `onFire` compose le résumé.

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

### N4 — La notification porte sur la carte en review

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

### N5 — Instruire le digest multi-agents (et le principe même de la coalescence)

**Pourquoi** : §2.5, §3.5. Le digest est le pire contenu émis, il est atteint dès la deuxième alerte,
et il annule tous les sous-titres en vol.
**Portée** : audit ciblé + décision. Deux options à comparer : améliorer le digest (décompte par
état + sujets), ou abandonner la coalescence maintenant que chaque notification a un sujet distinct.
La seconde est un changement de posture et mérite un ADR. **Pas d'implémentation avant l'arbitrage.**
**Acceptation** : une décision écrite, avec son ADR si l'option 2 est retenue.

### N6 — Le board comme source d'événements notifiables

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
> les sujets dédupliqués ; son titre compte toujours des agents (§3.5, carte N5).

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

## Ce que cet audit ne tranche pas

- **Le défaut de `NotifyPrefs.done`** (§2.7). À reconsidérer une fois N1 à N4 livrées, pas avant :
  aujourd'hui le défaut `off` est le bon réglage pour le contenu actuel.
- **La coalescence** (N5). Assumée comme un acquis par le code actuel ; l'audit constate qu'elle
  coûte cher et laisse l'arbitrage à sa propre carte.
- **La longueur exacte des troncatures** par plateforme. Les propositions de §3.2 visent « court »
  sans chiffrer ; un passage sur un vrai téléphone est le seul juge.
