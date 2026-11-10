# Partie 2 — Pourquoi c'est plat

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

## 2.1 — Le titre ne peut pas dire autre chose que « claude »

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

## 2.2 — Le corps dit deux fois la même chose et ne dit jamais le repo

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

## 2.3 — Le palier gratuit de réécriture est verrouillé derrière le palier payant

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

## 2.4 — Quand le copilot est activé, il est en concurrence avec lui-même

> **Renoncement assumé, tranché en 0.126.0 (carte N7). Le constat ci-dessous reste exact ; c'est sa
> conséquence qui a disparu.** N1 (0.120.0), N3 (0.122.0) et N10 (0.123.0) ont dissous la prémisse :
> la notification n'attend plus le copilot pour partir complète. Ce qui attend derrière la file
> n'est plus l'information, c'est la **tournure**.
>
> **Les deux corrections listées plus bas ont été écrites, mesurées sur pièce, et jetées.** La
> priorité dans `Copilot.ask` réordonne ce qui **attend** ; elle ne préempte pas un tour en vol
> (préempter, ce serait jeter le tour d'agent en cours — plus cher que la polish qu'il sauve). Or
> elle ne peut mordre dans aucun des deux cas réels :
>
> | Cas | La file du copilot | La garde `currentSolo` (§2.5) |
> |---|---|---|
> | Un seul agent finit | **vide** — la review de la même carte est en vol depuis ~28,5 s (poll `1500 ms` vs debounce `notifyDelayMs`, 30 s) | passe, mais la priorité n'a rien eu à réordonner |
> | Plusieurs finissent | la priorité doublerait les reviews 2..N | `outstanding.size > 1` → le sous-titre est **jeté** |
>
> Le gain n'existe que dans la rafale, et la rafale est exactement là où §2.5 le jette. Reste un
> créneau étroit — une review d'une **autre** carte encore en file pendant qu'une seule alerte est
> outstanding — jamais observé. La seconde option, un budget de temps propre au sous-titre, ne rend
> rien de mieux : elle abandonne plus tôt. C'est une économie de quota, pas un gain de polish.
>
> **Ce que ce renoncement coûte vraiment, et ce n'est pas la polish.** Quand le tour du sous-titre
> arrive enfin et que la garde le jette, ce n'est pas seulement une tournure perdue : c'est **un
> tour d'agent dépensé pour un résultat qu'on savait déjà jeté** — du quota, ce que la règle « le
> copilot dépense le quota de l'utilisateur » (CLAUDE.md, §The board) prend au sérieux. La garde
> `currentSolo` n'est aujourd'hui évaluée qu'**après** la réponse (`pushSubtitle`). L'évaluer
> **avant** de prompter demanderait de la rejouer au moment où le tour démarre, donc un crochet dans
> la file — précisément le mécanisme qu'on vient de retirer. C'est ce qu'il faudra reprendre si la
> mesure ci-dessous penche, et c'est là qu'il faudra le mettre : au démarrage du tour, pas dans un
> ordre de passage.

> **Condition de réouverture, et elle est déjà instrumentée** — les deux logs de `pushSubtitle`
> (`notify-subtitle.ts`) donnent le ratio sans une ligne de code à écrire :
>
> ```sh
> journalctl --user -u collie-board | grep -c 'dropped a stale answer'      # polish jetée
> journalctl --user -u collie-board | grep -cP '\[notify-subtitle\] \S+: "'  # polish rendue
> ```
>
> Si le premier écrase le second sur un usage réel, la carte se rouvre — et c'est alors §2.5 (la
> garde solo), pas la file, qu'il faudra rouvrir avec elle.

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

## 2.5 — Deux gardes suppriment le sous-titre quand il finit par arriver

`pushSubtitle` ne rend la mise à jour que si `coordinator.currentSolo(paneId)` répond
(`notify-subtitle.ts:123-128`), ce qui exige **deux** conditions (`notifications.ts:258-260`) :

- l'alerte est toujours en cours (le pane n'est pas reparti en `working`, n'a pas été traité) ;
- elle est **la seule** en cours.

La seconde est celle qui mord. Dès qu'un deuxième agent bascule, la notification devient le digest
`3 agents done` / `claude, claude, claude` et **tous** les sous-titres en vol sont jetés. Combiné à
§2.4 (le sous-titre arrive tard), c'est un mécanisme qui perd précisément dans le cas où on en aurait
le plus besoin : plusieurs agents qui finissent dans la même fenêtre.

> **Relu en 0.126.0 (§3.5, carte N5), réévalué le 2026-09-01 : la garde reste.** Ce qu'elle jette n'est plus la seule chance
> d'avoir un corps informatif — depuis que le digest compte par état et nomme les sujets, il en a un
> par construction. Le raisonnement complet, y compris pourquoi le copilote ne passe pas sur le
> digest, est en [§3.5](04-partie-3-proposition-de-contenu.md#35-le-digest-multi-agents).

## 2.6 — `sessionName` : gardé dans l'app, sorti des notifications — ✅ tranché en 0.134.0

> **Décision.** Le nom `/rename` **reste** là où il est lu — l'`AgentView` du snapshot, d'où sept
> surfaces in-app le tirent via `paneDisplayName` — et **disparaît** là où il ne l'est pas : l'`Alert`
> et l'entrée d'historique. Le correctif d'ordre de N8 (0.126.1) est retiré avec elles : l'alerte
> était son seul consommateur.

Bug secondaire, mais réel et cohérent avec §2.1. Dans `StateEngine.poll()`, la boucle qui appelle les
listeners de transition venait **avant** `enrichSessionNames()`, seul endroit qui posait
`a.sessionName`. L'objet `AgentView` remis à `NotificationCoordinator.onTransition` n'avait donc
jamais son `sessionName`, même quand le cache le connaissait depuis le poll précédent. N8 l'a corrigé
en appliquant le cache dans `toView`.

Sauf que le correctif remplissait un champ que **plus personne ne lisait** : depuis N5 et N9, aucune
surface de notification ne nomme le pane — ni le push, ni le digest (qui compte par état et liste les
sujets), ni la cloche (qui compose par `notifyContent`). Un champ rempli, testé et jamais lu coûte
son temps au prochain qui l'audite ; il fallait trancher.

**Ce que la lecture des appelants a corrigé dans le constat de N8.** « `paneDisplayName` n'est appelé
nulle part dans `bridge/` » est vrai ; « `sessionName` n'a plus de lecteur » ne l'est pas. Le champ a
onze lecteurs, tous côté app, tous sur le snapshot : huit écrans appellent `paneDisplayName`
(`pane-strip`, `agent-card`, `pane-list-column`, `pane-menu`, `agent-sidebar`, `pane-actions-sheet`,
`card-tile`, l'écran carte) et trois lisent le champ directement (`agent-chat`, `history`,
`card-tile`) — c'est-à-dire partout où une pastille ou un titre nomme un pane. Le test existe déjà :
`pane-strip.test.tsx` → *« shows Claude's /rename session name on a pill when no user label is set »*.
Supprimer le champ, son cache et `enrichSessionNames` aurait donc cassé le nommage des panes dans
l'app pour nettoyer un mort qui n'était pas là.

**Pourquoi ne pas le rebrancher côté notification.** Ce serait rouvrir §3.1-3.2 : le sujet est le
travail, pas le travailleur. Le seul cas où le nom `/rename` battrait le sujet actuel est le pane
sans carte, où le sujet retombe sur le repo — et il faudrait pour ça ajouter un champ à
`NotifySubject`, dans les deux copies de `notify-content.ts`, pour une valeur observée `null` sur
9 panes sur 9 (§2.1). Un discriminant qui n'existe jamais n'en est pas un.

**Ce qui a été supprimé** (aucun de ces trois points n'existe en amont — le fork rétrécit) :

| Suppression | Pourquoi |
|---|---|
| `Alert.paneLabel` / `sessionName` / `kind` (`notifications.ts`) | portés jusqu'au `onFire`, lus par personne |
| `NotifyLogEntry.paneLabel` / `sessionName` / `kind` (les deux copies) | la cloche compose par `notifyContent`, qui ne les regarde pas |
| l'application du cache dans `toView` + son test d'ordre | l'alerte était le seul lecteur de `sessionName` avant `enrichSessionNames` |
| `paneDisplayName` dans `bridge/types.ts` | doublon ajouté par le fork « pour que `notifications.ts` nomme comme le toast » — le bridge ne nomme plus aucun pane |

`enrichSessionNames`, le cache collant et `extractClaudeSessionName` restent intacts : ils
alimentent le snapshot, et le snapshot alimente l'app.

**Et `paneDisplayName` elle-même : vivante, côté app seulement.** Recherche refaite après le retrait,
pour qu'elle ne le soit pas une troisième fois. `bridge/` : **zéro appelant** — la copie est partie
avec la ligne ci-dessus, et les trois occurrences qui y restent sont des commentaires
(`notifications.ts:115`, `notify-content.ts:11`, `cards.ts:108`). `web/` : **onze sites d'appel dans
huit fichiers** — `agent-card` (×4), `pane-strip`, `pane-list-column`, `pane-menu`, `agent-sidebar`,
`pane-actions-sheet`, `card-tile`, `routes/card` — plus `lib/types.test.ts` qui couvre ses quatre
branches. (Onze aussi, mais ce n'est pas le même onze que les lecteurs de `sessionName` plus haut :
là on compte des lecteurs du champ, ici des appels de la fonction.) Il n'y a donc rien de plus à
supprimer : la fonction est l'arbitre du nom d'un pane dans l'app — et d'un `CardRuntime`, par son
`Pick` — et son seul code mort, le doublon bridge, l'a déjà quittée.

## 2.7 — `done` est off par défaut, et c'est cohérent avec le reste

Une notification « claude is done » sans sujet ne vaut effectivement pas un buzz : le défaut
`done: false` (`notify-prefs.ts:32`) est le bon réglage **pour le contenu actuel**. Ce défaut est
donc un symptôme, pas une cause — et il est ce qu'il faudra reconsidérer une fois le contenu réparé,
pas avant.

## 2.8 — Récapitulatif des causes

| # | Cause | Effet | Coût de correction |
|---|---|---|---|
| C1 | `paneDisplayName` retombe toujours sur `"claude"` (§2.1) | titre non discriminant | faible — changer le sujet du titre |
| C2 | `workspaceLabel` = titre de carte tronqué (§2.2) | corps redondant, repo absent | faible — lire `repoPath`/`cwd` |
| C3 | palier gratuit gardé par la pref copilot (§2.3) | aucune réécriture par défaut | **très faible** — déplacer un `if` |
| C4 | file copilot partagée avec la review (§2.4) | sous-titre tardif | moyen — priorité ou file séparée |
| C5 | garde `currentSolo` + digest (§2.5) | sous-titre jeté à ≥2 alertes | moyen — repenser le digest |
| C6 | `sessionName` posé trop tard (§2.6) | aucun : le push ne nomme plus le pane | ✅ tranché en 0.134.0 — le champ sort de l'alerte |
| C7 | trois compositions de contenu concurrentes (§1.3) | divergence des surfaces | moyen — factoriser |

---
