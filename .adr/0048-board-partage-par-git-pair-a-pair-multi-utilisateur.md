# 0048 — Board partagé par git, de pair à pair, multi-utilisateur

**Status:** Accepted
**Date:** 2026-10-23
**Supersedes (partiellement):** [0046](./0046-multi-machine-un-collie-central-et-des-noeuds.md) — § 1 côté
central, § 3, les points de § 8 qui supposent un central unique, l'effacement côté nœud de § 6, et
le lot 3 de son découpage.
Le reste de 0046 (rôle nœud, jeton, environnements, Windows, git et worktrees) tient ; 0046 n'est
pas éditée au-delà de sa ligne de statut.
**Trail:** journal de la roadmap, item *Multi-machine*, décision `bed340b1` (23/10)

## Context

0046 a posé un **central** — un seul Collie qui détient le board — et des **nœuds** sans board.
Deux besoins le cassent :

- **plusieurs machines de l'opérateur ont chacune leur board utile.** Avec un central, un portable
  hors ligne n'a pas de cartes ; le central devient le point dont tout dépend, le risque que 0046
  notait (*« le point central devient indispensable »*) et traitait seulement pour les agents ;
- **plusieurs personnes sur un même dépôt.** Un central est la machine de quelqu'un : les autres y
  seraient des invités, sur sa porte, sous sa sauvegarde.

Ce que le dépôt partagé offre déjà, sans rien ajouter : un **remote git** que tous joignent, des
**droits** (qui peut pousser), une **identité** par commit, un fonctionnement **hors ligne** et une
**fusion**. Le board, lui, est un SQLite local ([ADR 0006](./0006-the-board-scopes-by-repo-and-remembers-it.md),
`bridge/db.ts`), et `README.md` affirme *« No event sourcing »* — vrai pour l'état vivant (le poll
du snapshot), qui ne change pas ici.

Les règles de la maison qui contraignent la réponse :

- **`card` durable, `session` éphémère** — ne jamais persister l'état vivant ;
- **pas de nouvelle boucle** — tout ce qui est périodique pend à `engine.onUpdate` ;
- **`bridge/git.ts` est le seul shell-out** (plus `gate.ts`) ;
- **provenance dérivée, jamais déclarée** ([ADR 0010](./0010-an-agent-filed-card-is-traced-on-the-card.md)) ;
- **un snapshot `disconnected` s'ignore** ;
- **un réglage sensible n'est jamais lu du dépôt** ([ADR 0020](./0020-the-gate-is-the-operators-command-run-before-the-lead.md)) :
  un agent qui écrit dans le dépôt pourrait le réécrire.

## Decision

### 1. Opt-in par dépôt, désactivé par défaut

- **Rien n'est partagé tant que l'opérateur ne l'a pas activé, dépôt par dépôt**, par un geste dans
  les réglages du projet. Un board neuf, un dépôt neuf, une mise à jour de Collie : rien ne part.
- **Le réglage vit dans la base locale**, à côté de la gate et du mode d'intégration : une colonne
  `share` de `repo_pref` (le nom du remote ; `NULL` = non partagé), écrite par une route à écriture
  gardée. **Il n'est jamais lu du dépôt** — ni fichier `.collie`, ni `git config` du clone, ni la
  présence de la branche sur le remote. La présence de la branche peut être *signalée*
  (« ce dépôt a un board partagé sur `origin` »), jamais suivie d'effet sans le geste.
- **Ce qui reste local, toujours**, même partagé : gate, mode d'intégration, flow par défaut, dépôt
  masqué (`repo_pref`), autonomie de l'orchestrateur (`repo_autonomy`), épingles (`board_pref`).
  Ce sont des décisions de *l'opérateur de cette machine* sur ce qu'elle exécute ; les partager
  ferait d'une poussée d'un collègue une modification de ce que ma machine lance.

**Écarté — un fichier de réglage commité dans le dépôt** (`.collie/board.toml`). Le partager serait
pratique, mais un agent de carte écrit dans le dépôt : il pourrait activer le partage, ou changer de
remote, et faire sortir le board vers un endroit que l'opérateur n'a pas choisi.

**Écarté — partagé par défaut dès qu'il y a un remote.** Une spec de carte contient parfois un
extrait de log, un chemin, un secret collé par erreur ; ce qui part sur un remote git y reste dans
l'historique (§ 2). Sortir des données exige un consentement, donné une fois, par dépôt.

### 2. Format — un journal en ajout seul, sur une branche orpheline, rejoué dans SQLite

**La branche.** `collie-board`, **orpheline** (aucun ancêtre commun avec le code), sur le remote
choisi. Localement, elle est suivie par une ref hors de `refs/heads` — `refs/collie-board/journal` —
pour qu'elle n'apparaisse ni dans `git branch`, ni dans les sélecteurs de base du board, ni dans un
`worktree.create`. Orpheline parce que : une PR vers `main` est refusée par GitHub (*no common
history*), un merge par erreur se voit tout de suite, et la protection de `main` ne s'y applique
pas.

**Les fichiers.** Un dossier par entité, **un fichier par écrivain** :

```
cards/<cardId>/<pairId>.jsonl
phases/<phaseId>/<pairId>.jsonl
runs/<runId>/<pairId>.jsonl        # les lots
roadmap/<pairId>.jsonl             # vision, items, décisions
```

`<pairId>` est l'identifiant stable de l'installation Collie qui écrit (tiré au premier
lancement, gardé dans l'état local). **Chaque pair n'ajoute qu'à ses propres fichiers.** Deux pairs
n'écrivent donc jamais le même fichier : la fusion de deux arbres est l'union des chemins, et pour
un même chemin la version du remote est toujours un préfixe de celle de son propriétaire. **Aucun
conflit textuel n'est possible**, sans `git merge` ni pilote de fusion — un « un fichier par carte »
partagé entre écrivains, lui, conflicterait à chaque ajout concurrent en fin de fichier.

**Une ligne = un événement :**

```json
{"v":1,"hlc":"1729677600123.0004.a1b2c3","type":"card.set","by":"stephane@…","fields":{"status":"todo","title":"…"}}
```

Types : `<entité>.set` (champs modifiés), `<entité>.deleted` (pierre tombale), `card.event` (une
ligne du journal de carte d'aujourd'hui, table `event`), `card.review`, `card.claimed` (§ 7),
`deliverable.published` (§ 4).

**Résolution des conflits : dernier écrivain par champ, ordonné par une horloge hybride (HLC).**

- Chaque champ d'une entité prend la valeur de l'événement de plus grand `hlc` qui le pose. C'est
  commutatif : l'ordre d'arrivée des événements n'importe pas, deux pairs qui ont les mêmes lignes
  ont le même board.
- Le HLC est `(ms physique, compteur, pairId)` : avant d'écrire, un pair avance son horloge au-delà
  de tout `hlc` qu'il a lu. Une modification faite *après avoir vu* celle d'un autre la bat donc
  toujours, même si l'horloge murale de l'autre machine avance. Le `pairId` départage deux
  événements simultanés.
- La pierre tombale est **définitive** : après `card.deleted`, les `card.set` sont ignorés, quel que
  soit leur `hlc` — comme une suppression d'aujourd'hui, qui ne se défait pas.
- Un texte long (spec, critères) se remplace en entier ; la version écrasée reste lisible dans le
  journal de la carte. Pas de fusion de texte.

**Écarté — `ts` + auteur.** C'est le HLC sans la règle « avancer au-delà de ce qu'on a lu » : un
poste Windows dont l'horloge avance de trois minutes gagne toutes les éditions concurrentes
pendant trois minutes, y compris contre une édition faite *en réponse* à la sienne. Le HLC coûte une
vingtaine de lignes pures, testables sous `bun test`.

**Rejoué dans le SQLite local.** La base reste ce que lisent les routes, l'UI, l'orchestrateur ;
pour un dépôt partagé, ses lignes sont la **projection** du journal. Une table `journal_field
(entity, field, hlc)` garde le `hlc` gagnant de chaque champ, pour appliquer un événement en
O(champs). La projection se reconstruit de zéro depuis la branche (`rebuild`), ce qui sert à la
migration (§ 6) et au doute.

**Ce qui n'y va jamais :**

- **l'état vivant** : `session`, `workspace_id`, pane ids, statut d'agent, snapshot — lus du snapshot
  (ou d'un pair, § 4), jamais écrits ;
- **les chemins locaux** : `repo_path` ne part pas — le dépôt *est* le journal ; chaque pair le
  rapporte à son propre clone. Le chemin d'un environnement non plus (0046 § 4) ;
- **les secrets et la topologie** : jetons, `peers.toml`/`node.toml`, abonnements push, identités
  d'appareils ;
- **les réglages de l'opérateur** (§ 1) et la **mémoire de l'orchestrateur** (§ 7) ;
- **l'audit d'accès, le journal des notifications, l'état du copilote** — ce que *cette* machine a
  vu ou fait ;
- **les livrables** (octets) : un journal git garde tout pour toujours, et un fichier de 25 Mo par
  carte ferait grossir chaque clone. Le journal porte `deliverable.published {name, size, sha256,
  pair}` ; les octets restent dans le store du pair qui les a reçus (§ 4) ;
- **les gabarits d'agent et les flows** ([0026](./0026-an-agent-template-is-a-role-kept-in-the-board.md),
  [0032](./0032-a-flow-is-a-named-pipeline-kept-in-the-board.md)) : ils sont au board, pas au
  dépôt. Une carte qui nomme un flow que ce pair n'a pas retombe sur le flow par défaut local.

**Écarté — un CRDT complet (Automerge, Yjs).** Il résout ce qu'on n'a pas : la fusion fine de texte
édité à plusieurs mains au même moment. Il coûte ce qu'on refuse : une dépendance lourde au cœur
du bridge, un format binaire illisible dans `git log` et impossible à réparer à la main, un
document unique qui grossit sans compactage simple, et une deuxième source de vérité à côté de
SQLite. Les entités du board sont des enregistrements à champs ; le dernier écrivain par champ
avec un HLC *est* un CRDT (un registre LWW par champ), à la taille du problème.

**Écarté — la base SQLite commitée** (ou un dump). Binaire, sans fusion, et elle emporte tout ce
que la liste ci-dessus exclut.

**Écarté — un fichier d'état par carte, réécrit à chaque modification** (`cards/<id>.json`).
Lisible, mais deux écritures concurrentes conflictent textuellement et l'une est perdue au
rebase ; le journal par écrivain n'a pas ce cas.

### 3. Synchronisation — accrochée à `engine.onUpdate`, bridée, par `git.ts`

- **Une écriture locale** sur une entité d'un dépôt partagé écrit la ligne SQLite **et** l'événement
  dans une table `journal_outbox`, **dans la même transaction** : un crash ne perd ni ne duplique.
- **Le consommateur de synchro** pend à `engine.onUpdate`, comme `ContextTracker`, et se bride
  lui-même : au plus **une opération git en vol par dépôt** ; un `fetch` au plus toutes les 60 s ;
  un envoi au tick suivant une écriture locale, au plus toutes les 10 s. **Pas de minuteur.**
- **Un envoi**, entièrement en plomberie git par `git.ts` (argv, jamais de shell, jamais de
  checkout, jamais le worktree de l'opérateur touché) : `hash-object` des fichiers de ce pair
  augmentés de l'outbox, `mktree`, `commit-tree` avec pour parents la ref locale et celle du remote,
  `update-ref`, `push <remote> refs/collie-board/journal:refs/heads/collie-board`.
- **Une réception** : `fetch` de `refs/heads/collie-board`, lecture des seuls fichiers changés
  (`diff-tree`), application des lignes nouvelles à la projection.
- **Push refusé, non-fast-forward** (un autre pair a poussé entre-temps) : `fetch`, union, nouvel
  essai **au tick suivant**. Pas de boucle de relance.
- **Push refusé, droits** (403, branche protégée) : le dépôt passe **en lecture seule pour ce pair**,
  dit dans les réglages du projet. Les routes d'écriture des entités de ce dépôt **refusent** alors,
  avec la raison, plutôt que d'empiler des modifications que personne d'autre ne verra.
- **Hors ligne** (remote injoignable) : rien ne change pour l'opérateur. SQLite reste la vérité
  locale, l'outbox grossit, le projet affiche *« N changements non envoyés »* — un indicateur, pas
  une notification. Au retour du réseau, l'envoi reprend au tick suivant.

**Écarté — un `git pull` dans un worktree dédié.** Un checkout de plus par dépôt, un index que
quelqu'un finira par salir, et un `merge` qui peut s'arrêter sur un conflit que la disposition par
écrivain rend de toute façon impossible.

**Écarté — un hook git (`post-commit`, `post-merge`) qui synchronise.** Il vivrait dans le dépôt,
donc à la portée d'un agent, et ne se déclenche pas quand seul le board change.

### 4. Pair à pair vivant — chaque Collie est un board et un nœud

Le central disparaît : **chaque installation a le board ET les routes `/api/node/*`** de 0046 § 2
(lot 2 de son découpage). Le rôle `node` sans board de 0046 reste possible — une machine qui ne fait
qu'exécuter — mais n'est plus le seul.

- **Chaque pair déclare les pairs qu'il lit** dans un `peers.toml` local (nom, URL, jeton) en `0600`,
  jamais en base — c'est le `nodes.toml` de 0046 sous un autre nom. La relation n'est pas symétrique
  d'office : A lit B si A a un jeton émis par B.
- **Lecture du vivant** sur `engine.onUpdate`, bridée (une requête en vol par pair). **Un pair
  injoignable est un snapshot `disconnected`**, avec exactement les conséquences de 0046 § 3 : ses
  cartes restent dans leur colonne, marquées *« pair injoignable depuis HH:MM »*, rien n'est
  réconcilié, aucune action n'est offerte. Ce qui change : le *durable* de ces cartes, lui, continue
  d'arriver par git.
- **Seul le pair qui fait tourner une carte réconcilie son statut.** `reconcile()` lit un pane ; un
  pane n'existe que sur sa machine. Les autres lisent le statut dans le journal, et le vivant chez
  le pair.
- **Qui peut lancer chez qui.** Un jeton donne la **lecture** ; le **lancement** est une permission
  à part, accordée par le propriétaire de la machine, **par environnement**, dans son `node.toml` :
  `launch = ["alice-portable"]`. Sans elle, `POST /api/node/launch` répond 403. L'environnement reste
  déclaré par le pair qui l'offre (0046 § 4) ; aucun chemin ne voyage.
- **L'autonomie du propriétaire s'applique.** Un lancement demandé par un pair compte, chez le
  propriétaire, comme un lancement d'orchestrateur : ses bornes `repo_autonomy`
  ([0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md),
  [0047](./0047-the-orchestrator-may-start-a-lot-when-nothing-runs-if-the-operator-allows-it.md))
  le refusent comme elles refuseraient le sien. Personne ne lance plus chez moi que moi.
- **Livrables** : le pair qui exécute la carte les reçoit (0045, MCP stdio local) et les garde ; le
  journal annonce `deliverable.published` ; chaque pair qui affiche la carte **recopie** les octets
  au premier contact (`GET`) dans son propre store, et les a ensuite sans dépendre de l'autre.
  L'effacement côté nœud de 0046 § 6 tombe : avec plusieurs lecteurs, le premier viderait la boîte
  des suivants.

**ADR 0013.** L'exception de 0046 s'élargit d'un cran et pas plus : un pair est client **des seuls
pairs listés dans son `peers.toml`**, et de son remote git (ce qu'il était déjà pour `fetch` et les
PR). Un *consommateur* au sens de 0013 lit toujours son propre Collie et n'est jamais appelé.

### 5. Multi-utilisateur — les droits du remote, l'auteur git, l'identité Tailscale

- **Qui peut écrire le board partagé = qui peut pousser la branche.** Aucune ACL propre à Collie :
  le remote en a déjà, et l'opérateur sait les régler.
- **L'identité d'un pair** est le `user.email` git du clone, lu par `git.ts` à l'activation et
  affiché ; c'est l'auteur des commits du journal et le champ `by` de ses événements.
- **Deux champs nouveaux sur la carte :**
  - `createdBy` — **dérivé** à la création par le pair qui crée (son identité git), **hors de
    l'allowlist** de création comme `origin` : aucun corps de requête ne le déclare
    (ADR 0010). Un agent qui file une carte reste `origin = agent`, et `createdBy` est le
    propriétaire de la machine où tourne l'agent ;
  - `assignee` — une **intention** (« c'est pour Alice »), éditable, dans l'allowlist ; c'est une
    identité git. Il sert à l'orchestrateur (§ 7), pas à un droit.
- **Ce que vaut la provenance, dit franchement.** `by` et `createdBy` sont dérivés *par le pair qui
  écrit* ; un pair modifié peut mentir, comme un auteur de commit. La confiance du board partagé
  est celle du remote : qui peut pousser du code peut pousser des cartes. Signer le journal
  (commits signés, vérifiés à la lecture) est la réponse si ce n'est plus suffisant — pas dans les
  premiers lots.
- **L'identité Tailscale garde les portes, elle ne signe pas.** `Tailscale-User-Login` reste ce
  qu'il est dans `checkAccess` : qui a le droit de parler à *ce* bridge. Entre pairs, le jeton
  s'ajoute au login, comme dans 0046 § 2 ; `node.toml` dit quel login est attendu pour quel jeton.
  Un même Collie reste mono-opérateur : deux personnes se partagent un dépôt, pas un bridge.

**Même tailnet ou tailnets différents.** Le partage **durable** (§ 2–3) n'a besoin d'aucun réseau
entre les pairs : seulement du remote. Deux personnes sans tailnet commun ont donc un board
partagé complet, sans le vivant des cartes de l'autre. Le **vivant** (§ 4) exige que A joigne le
`serve` de B :

- **même tailnet** : rien de nouveau, c'est la topologie de 0046 avec deux logins ;
- **tailnets différents** : par le **partage de nœud** Tailscale (B partage sa machine avec A).
  *Non tranché* — voir les questions ouvertes.

### 6. Migration et retour arrière

- **Activer sur un dépôt qui a déjà des cartes** : Collie prend d'abord une sauvegarde
  ([`backup.ts`](../bridge/backup.ts)), puis `fetch` la branche.
  - **branche absente** : il crée la branche orpheline et écrit, pour chaque entité du dépôt, un
    événement `*.set` portant tous ses champs partageables (et sa pierre tombale, rien pour les
    supprimées) ; un commit *« import »*, poussé ;
  - **branche présente** (un autre l'a activée avant) : la projection est reconstruite depuis le
    journal, puis les entités locales **inconnues du journal** y sont importées comme ci-dessus.
    Les ids sont aléatoires : deux boards n'ont pas d'entité commune, l'union ne fusionne rien par
    erreur. Deux cartes au même titre restent deux cartes.
- **Désactiver** : la synchro s'arrête, l'outbox non envoyée est annoncée (*« N changements ne
  partiront pas »*) puis vidée, `journal_field` est vidée. La base locale *est déjà* le board
  complet : il n'y a rien à convertir. La branche sur le remote n'est pas touchée — les autres pairs
  continuent ; l'effacer est un geste sur le remote, pas du board.
- **Réactiver** est une activation : le journal fait foi pour les entités qu'il connaît, et les
  modifications locales faites pendant la coupure sur ces entités **sont perdues** (la sauvegarde
  prise à l'activation les garde). Dit dans le geste, avant.

**Écarté — rejouer à la réactivation le diff entre la base et la projection.** Il ferait gagner,
avec un `hlc` d'aujourd'hui, des valeurs écrites il y a des semaines contre des modifications
d'autres pairs qui les ont vues passer : exactement la régression que le HLC évite.

### 7. L'orchestrateur — un par utilisateur, et une réservation par git

- **Un orchestrateur par pair**, donc par utilisateur et par machine, comme aujourd'hui. Sa mémoire
  (`orchestrator_memory`) et son autonomie restent locales. Il lit la roadmap, les phases, les
  décisions partagées, et peut les écrire (LWW par champ).
- **Un lot appartient à son créateur.** Seul l'orchestrateur du pair qui a créé le lot le lance, le
  pousse, le termine ([0040](./0040-a-lot-with-an-orchestrator-is-pushed-by-the-orchestrator.md)),
  et seul celui-là est réveillé en fin de lot
  ([0028](./0028-the-orchestrator-is-woken-by-the-board-at-the-end-of-a-lot.md)). Les autres le
  voient.
- **Lancer une carte partagée la réserve d'abord** : un événement `card.claimed {pair}`, commité et
  poussé **avant** le lancement. Le push git est une comparaison-et-échange sur la ref : s'il est
  refusé, le pair `fetch`, et si un autre a réservé la carte entre-temps, le lancement est
  abandonné avec sa raison. Deux orchestrateurs ne lancent donc jamais la même carte.
- **Hors ligne**, la réservation est impossible : on ne lance que les cartes **assignées à soi**
  (`assignee`) — personne d'autre n'est censé les prendre. Un orchestrateur ne lance jamais, même
  en ligne, une carte assignée à quelqu'un d'autre.

**Écarté — un seul orchestrateur par dépôt partagé.** Il faudrait élire sa machine, la garder
allumée, et gérer sa panne : c'est le central de 0046 revenu par l'orchestrateur.

**Écarté — la réservation par dernier écrivain (sans push synchrone).** Deux pairs hors de vue
l'un de l'autre réservent la même carte, lancent tous les deux, et le LWW désigne un gagnant après
coup — deux agents ont déjà écrit deux branches.

## Questions ouvertes

1. **Tailnets différents.** Le vivant entre deux utilisateurs de tailnets distincts passe-t-il par
   le partage de nœud Tailscale ? À mesurer avant de le promettre : un `tailscale serve` joint
   depuis un nœud partagé injecte-t-il `Tailscale-User-Login`, et lequel ? Sinon : vivant réservé au
   même tailnet, git seul au-delà. **Question à l'opérateur**, déjà ouverte dans `bed340b1`.
2. **L'exécution d'un lot** (le curseur de `run` : étape courante, carte en cours) est-elle
   partagée, ou seulement son plan (les cartes choisies) ? Proposition : le plan est partagé, le
   curseur reste chez le pair qui exécute et se lit en vivant — à trancher au lot 3.
3. **Signature du journal** (§ 5) : quand le remote ne suffit plus comme frontière de confiance.
4. **Compactage** : un journal en ajout seul grossit. Seuil et forme (un événement *snapshot* par
   écrivain qui remplace ses lignes) à décider quand on aura mesuré la taille réelle.
5. **Une carte qui nomme un flow ou un environnement inconnu de ce pair** : repli local (proposé
   ci-dessus pour le flow), ou carte non lançable ici ?

## Consequences

- **Coûts acceptés.** Toute donnée de carte d'un dépôt partagé part sur le remote **et reste dans
  son historique**, suppression comprise — l'activation le dit. Une branche de plus sur le remote.
  Un `pairId`, un HLC, une outbox et une projection à maintenir. Une modification concurrente d'un
  même champ en écrase une autre (visible au journal, non signalée). Hors ligne, on ne lance que
  ses propres cartes.
- **Ce qui reste vrai.** SQLite reste la seule chose que lisent l'UI et les routes ; l'état vivant
  n'est jamais persisté ni partagé par git ; aucune boucle nouvelle ; `git.ts` seul shell-out ;
  bridge en loopback, une porte gérée par machine (0001 amendée par 0046) ; aucun réglage sensible
  lu du dépôt ; un dépôt non activé se comporte exactement comme aujourd'hui.
- **À mettre à jour quand le lot 1 atterrit** : `README.md` (*« No event sourcing »* devient *« pas
  d'event sourcing de l'état vivant ; le board partagé, opt-in, est un journal »*) et
  `ARCHITECTURE.md`.
- **Ce qui justifierait de revenir dessus.** Un besoin réel d'édition simultanée d'un même texte
  (alors un CRDT de texte sur ce seul champ, pas sur le board) ; un remote qui ne joue plus le rôle
  de frontière de confiance ; un journal dont la taille gêne les clones malgré le compactage.

## Découpage proposé

Les lots 1 à 3 se démontrent avec deux installations sur une même machine (deux `stateDir`, un
remote local nu) ; le lot 4 a besoin de deux machines. Les lots 0, 1, 2, 4 et 5 de 0046 tiennent ;
son lot 3 (le central) est remplacé par les lots 4 et 5 ci-dessous.

| Lot | Contenu | Effort |
|---|---|---|
| **1 — le journal, sans git** | `pairId` ; HLC pur ; `journal_outbox` écrite dans la transaction de chaque écriture d'entité ; projection LWW par champ (`journal_field`), pierre tombale, `rebuild` ; tests `bun test` de commutativité et d'horloge en avance | M |
| **2 — la synchro git** | `repo_pref.share` + route gardée + réglage du projet ; plomberie dans `git.ts` (branche orpheline, ref hors `refs/heads`, union par écrivain, push/fetch) ; consommateur sur `engine.onUpdate` bridé ; non-fast-forward, lecture seule sur 403, indicateur hors ligne ; activation avec import et sauvegarde, désactivation | L |
| **3 — plusieurs utilisateurs** | identité git du pair ; `createdBy` dérivé hors allowlist, `assignee` ; `card.claimed` par push synchrone ; lot à son créateur ; règles de l'orchestrateur (pas de carte d'un autre, hors ligne = assignées à soi) ; trancher la question ouverte 2 | M |
| **4 — le vivant de pair à pair** | `peers.toml` ; board **et** `/api/node/*` sur chaque installation ; lecture des pairs sur `onUpdate`, injoignable = `disconnected` ; réconciliation par le seul pair exécutant ; permission `launch` par environnement dans `node.toml`, bornes d'autonomie du propriétaire ; livrables recopiés sans effacement | M–L |
| **5 — hors du tailnet** | selon la réponse à la question ouverte 1 : mesure du partage de nœud, doc, ou rien | S |
| **6 — compactage** | quand la taille mesurée le demande (question ouverte 4) | S |
