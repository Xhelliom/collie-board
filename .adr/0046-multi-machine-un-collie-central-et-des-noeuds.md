# 0046 — Multi-machine : un Collie central et des nœuds

**Status:** Accepted
**Date:** 2026-10-22
**Amends:** [0001](./0001-one-managed-front-door.md) (une porte gérée — *par machine*) ·
[0013](./0013-the-bridge-does-not-know-its-consumers.md) (le central devient client de ses nœuds) —
ni l'une ni l'autre n'est éditée au-delà de sa ligne de statut.
**Trail:** [reconnaissance Windows](../docs/multi-machine/reconnaissance-windows.md) ·
journal de la roadmap, item *Multi-machine* (décisions `adeab702`, `d6e5465c`, `e3863987`, `0bb3e6ce`)

## Context

L'opérateur veut piloter plusieurs de ses ordinateurs depuis une seule interface — sa propre infra,
pas un service hébergé. Deux machines sont visées : une deuxième Arch (`arch-2`) et un poste Windows
où un agent doit piloter des applis Windows, SolidWorks en tête, par COM.

Ce qui était déjà tranché avant cet ADR :

- **Un nœud Windows est natif, pas WSL.** Le but est de piloter des applis Windows ; un agent dans
  une VM Linux ne parle pas au COM du bureau.
- **Le serveur herdr tourne dans la session utilisateur ouverte** (bureau interactif). Un service
  tourne en session 0, sans bureau : SolidWorks s'y lance invisible ou bloque sur un dialogue que
  personne ne voit.

Ce que la reconnaissance a **mesuré** sur le poste Windows (herdr 0.9.5, Bun 1.4.3) :

- l'API herdr y est un **named pipe**, déjà géré par `bridge/dial.ts`, sans réglage ;
  `session.snapshot`, `pane.*`, `events.subscribe`, `agent.start`, `worktree.create` répondent ;
- le bridge démarre sous Bun et sert `/api/snapshot`, les cartes, le diff ; 1403 tests Bun sur 1457
  et toute la suite web passent ;
- `tailscale serve` y publie un port local et injecte `Tailscale-User-Login` ;
- le COM d'une appli graphique se pilote depuis un pane herdr (STA, intégrité moyenne, session 2) ;
- ce qui manque est autour : supervision, actions du plugin (toutes en Bash, `platforms =
  ["linux","macos"]`), un vrai bug de chemins (`C:/…` de git contre `C:\…` de Node et herdr),
  `galleryRoot()` sous `/tmp`, `since-hook.sh` qui dépend de `jq`.

Trois règles de la maison résistent à l'idée, et l'ADR doit dire comment elles plient :

1. **[ADR 0001](./0001-one-managed-front-door.md)** — une seule porte d'entrée gérée.
2. **[ADR 0013](./0013-the-bridge-does-not-know-its-consumers.md)** — le bridge n'appelle personne.
3. **`ARCHITECTURE.md` § 9** — *Primary session only : un pane id ne veut rien dire dans un autre
   serveur herdr.*

## Decision

### 1. Topologie — un central, des nœuds, le tailnet entre eux

- **Le central** est le Collie d'aujourd'hui : le board, les cartes, la roadmap, l'orchestrateur, le
  copilote, les notifications. Il a son herdr à lui et continue de lancer des cartes localement.
- **Un nœud** est une machine avec son herdr et **le même bridge en rôle `node`** : le miroir de
  panes de Collie amont reste (l'opérateur peut ouvrir le nœud directement depuis son téléphone),
  les routes du board sont éteintes (pas de cartes, pas de roadmap, pas d'orchestrateur, pas de push),
  une famille de routes `/api/node/*` est allumée. Le rôle se lit de la présence d'un `node.toml`
  dans le répertoire de config.
- **Chaque machine a sa propre porte : `tailscale serve`, gérée par son propre
  `collie-board-ctl`, jamais `funnel`.** Le central appelle un nœud sur
  `https://<nœud>.<tailnet>.ts.net`, à travers le `serve` du nœud. Le bridge du nœud reste lié au
  loopback ; aucun port n'écoute sur l'IP du tailnet.

**Écarté — un programme « agent de nœud » séparé.** Deux bases de code, deux portages Windows, deux
suites de tests, pour un sous-ensemble strict de ce que le bridge sait déjà faire. Un rôle coûte un
`if` à l'enregistrement des routes.

**Écarté — un bridge sans tête et un serveur central** (le central qui parle aux herdr des nœuds,
socket transporté par le tailnet). C'est ce que le README appelait *« inverser l'architecture »* :
le socket herdr n'a ni authentification ni chiffrement, il ne sort pas de sa machine. Et un nœud
sans bridge ne survit pas à la panne du central (§ 3).

**Écarté — un bind du bridge sur l'IP du tailnet, sans `serve`.** C'est ouvrir une deuxième porte
non gérée sur chaque nœud, et perdre l'identité que `serve` injecte.

**Amendement de l'ADR 0001.** La règle devient *exactement une porte gérée **par machine***. Le
critère de l'ADR 0001 — *on ne gère que ce qu'on fait tourner et qu'on peut tester* — tient :
c'est le même `tailscale serve`, testé sur Linux et, par la reconnaissance, sur Windows. Une
deuxième porte sur une même machine, ou un autre tunnel géré, restent refusés ; la prohibition du
`funnel` s'applique à chaque nœud.

**Amendement de l'ADR 0013 — l'exception est bornée au central, vers ses nœuds.** L'ADR 0013 se
réservait ce cas : *« Force 1 falls the moment the target is durable too »*. Un nœud est durable —
une unité toujours levée, comme le central. Ce qui est permis, et rien d'autre :

- **le central est client de ses nœuds**, et des seuls nœuds listés dans son `nodes.toml` ;
- **le nœud ne connaît pas le central** : il n'appelle personne, ne pousse rien, ne garde aucun état
  « le central est-il là ? ». Pour lui, le central est un client porteur d'un jeton (§ 2). L'ADR
  0013 s'applique au nœud sans exception ;
- **pas de nouvelle boucle** : la lecture des nœuds pend à `engine.onUpdate` du central, bridée à
  l'intérieur du consommateur (au plus une requête en vol par nœud, comme `ContextTracker`) ;
- un *consommateur* au sens de l'ADR 0013 (assistant vocal, script) reste un consommateur : il lit
  le central, jamais un nœud, et le central ne l'appelle toujours pas.

### 2. Confiance — un jeton par nœud, et l'identité Tailscale en plus

- **Le central s'authentifie par un jeton propre à chaque nœud** :
  `authorization: Bearer <jeton>`, comparé en temps constant. Côté nœud, le jeton est dans
  `node.toml` ; côté central, dans `nodes.toml` (nom, URL, jeton). Fichiers en `0600`, **jamais en
  base** : la base part dans la sauvegarde, et un jeton de nœud vaut un shell sur ce nœud.
- **Le contrôle existant reste devant** : `checkAccess` garde l'allowlist d'hôtes et la règle
  `COLLIE_BOARD_TRUSTED_USER` sur `Tailscale-User-Login`. Seule la règle *« une écriture sans
  `Origin` depuis un hôte non loopback est refusée »* cède, pour `/api/node/*` seulement, au jeton —
  une requête serveur à serveur n'a pas d'`Origin`.
- **Sans jeton configuré, `/api/node/*` répond 404.** Rien n'est ouvert par défaut.
- L'opérateur peut resserrer au niveau du tailnet (une règle ACL qui n'autorise que le central vers
  le port 443 du nœud) : documenté, pas géré par Collie, pour la raison de l'ADR 0001.

**Écarté — l'identité Tailscale seule.** `Tailscale-User-Login` dit *quel utilisateur*, pas *quelle
machine* : tous les appareils de l'opérateur, téléphone compris, portent le même login, et un nœud
taggé n'en porte aucun. Elle ne distingue pas le central d'un onglet ouvert ailleurs.

**Écarté — un secret partagé entre tous les nœuds.** Une fuite ouvrirait toutes les machines ; un
jeton par nœud se révoque seul, en éditant deux fichiers.

**Écarté — le jeton seul, sans l'identité.** L'identité ne coûte rien, elle est déjà là, et elle
borne une fuite de jeton aux appareils de l'opérateur.

**Ce qu'un nœud accepte**, et seulement par des routes typées :

- lire : son snapshot (agents, shells), un pane, ses environnements déclarés (§ 4), le diff d'une
  branche de carte ;
- écrire : répondre dans un pane, envoyer des touches de la grammaire herdr, lancer une carte dans
  un environnement **qu'il a déclaré**, terminer la session d'une carte qu'il a lancée.

**Ce qu'un nœud refuse :**

- **tout appel herdr brut.** Pas de relais RPC générique : le lancement passe par `launchAgent()` et
  `promptAndConfirm()` **du nœud**, avec leurs trois courses vérifiées (`ARCHITECTURE.md` § 9) —
  jamais un `agent.start` ou un `agent.prompt` envoyé par le central ;
- **tout chemin envoyé par le central.** Le central nomme un environnement ; le nœud le résout
  vers son propre dépôt. Un central compromis ou un jeton volé ne fait pas lancer un agent dans un
  dossier arbitraire ;
- toute commande hors `git.ts` et `gate.ts`, et toute gate qui viendrait du réseau ;
- les routes du board : un nœud n'a pas de cartes.

Accepté, et dit : un jeton permet de taper dans les panes du nœud, donc d'y exécuter ce que
l'utilisateur du nœud peut exécuter. C'est le même modèle que le bridge local — *treat the bridge
as remote shell access* — étendu d'une machine.

### 3. Panne — chaque machine tient seule ; un nœud injoignable est un snapshot `disconnected`

- **Le nœud ne dépend pas du central.** Ses agents, son herdr, son bridge tournent sans lui. Si le
  central tombe, l'opérateur ouvre `https://<nœud>.<tailnet>.ts.net` et y retrouve le miroir de
  panes de Collie amont : lire, répondre, interrompre. Pas de cartes, pas de notifications — c'est le
  mode dégradé, pas un deuxième board.
- **Une seule règle côté central : un nœud injoignable est un snapshot `disconnected`.** Dès qu'une
  lecture échoue ou dépasse son délai, le central garde en mémoire le dernier snapshot bon du nœud,
  **l'ignore** comme il ignore un snapshot local `disconnected`, et :
  - les cartes du nœud restent dans leur colonne, statut tel que lu en dernier, marquées
    *« nœud injoignable depuis HH:MM »* ;
  - **rien n'est réconcilié** : aucune carte ne devient orpheline, terminée ni bloquée ; aucune
    notification n'est levée ni rétractée à partir de ce snapshot ;
  - **aucune action n'est offerte** sur ces cartes (répondre, relancer, terminer) — elles
    échoueraient, ou pire, partiraient vers un état qu'on ne voit plus.
  Au retour du nœud, le snapshot suivant reprend la main, comme après une coupure du socket local.
  Rien de cela n'est persisté : *card durable, session ephemeral*.

**Écarté — un état par carte (« injoignable », « inconnu », « dernier vu »).** Une règle par cas,
c'est autant de façons de mentir sur un état qu'on ne voit plus. La règle `disconnected` existe,
elle est testée, chaque consommateur sait déjà s'y plier.

**Écarté — un nœud qui file en local, puis resynchronise.** C'est la synchronisation de deux sources
de vérité que le board a toujours refusée (pas d'*event sourcing*, `README.md`).

**Écarté — un central redondant.** Hors périmètre (§ 8). Le risque noté dans la roadmap — *« le
point central devient indispensable »* — est traité par l'autonomie du nœud, pas par la duplication
du central.

### 4. Environnements nommés — déclarés par le nœud, portés par la carte

- **Un environnement est déclaré sur le nœud qui l'offre**, dans son `node.toml` : un nom
  (`windows-solidworks`, `arch-2`), le chemin de son clone local, et plus tard sa gate. Le nœud le
  publie par `GET /api/node/environments`.
- **Le central déclare ses nœuds, pas leurs environnements** : `nodes.toml` dit *qui* (nom, URL,
  jeton) ; la liste des environnements est lue des nœuds, gardée en mémoire au dernier contact.
- **Une carte porte un nom d'environnement** — une colonne `environment`, `null` pour local. C'est
  une intention, donc durable, et elle entre dans l'allowlist de création. Le nom choisit le nœud
  (celui qui le déclare) et le dépôt (celui qu'il y associe).
- **Un nom est unique sur le tailnet.** Deux nœuds qui déclarent le même nom : les deux sont refusés
  pour ce nom et les réglages du central le disent. Pas de « premier arrivé ».
- **Nœud absent au lancement : le lancement est refusé, avec sa raison.** *« windows-solidworks :
  nœud win-cad injoignable »*. La carte reste où elle est. Pas de file d'attente, pas de relance
  automatique (ce serait une boucle), **jamais de repli** sur une autre machine ni sur le central —
  un agent SolidWorks lancé sur Linux ne fait rien d'utile et ressemble à un succès. Dans un lot,
  c'est un lancement raté comme un autre.

**Écarté — les environnements déclarés sur le central.** Le central enverrait alors un chemin au
nœud, que le nœud devrait croire ; c'est exactement ce que § 2 refuse. Et le nœud est le seul à
savoir où est son clone.

**Écarté — les environnements en base, éditables dans l'UI.** Une écriture du board deviendrait une
écriture de *« où un agent a le droit de tourner »*, et la sauvegarde emporterait la topologie avec
les cartes.

**Écarté — une carte qui porte une machine, pas un environnement.** C'était la première idée de la
roadmap. Une machine porte plusieurs dépôts et plusieurs contextes (SolidWorks ou non) ; le nom
choisit les deux à la fois.

**Ce que ça change à `ARCHITECTURE.md` § 9 (*Primary session only*).** Sur le central, un pane d'un
nœud est qualifié par le nom du nœud (`win-cad/w1:p3`) ; il n'est jamais confondu avec un pane
local, et aucune ligne de la base ne stocke un pane id. La règle locale reste : une seule session
herdr par machine.

### 5. Git et worktrees — le nœud a son clone, le remote est le point de rencontre

- **Le nœud a son propre clone** du dépôt (le chemin de l'environnement). `worktree.create` tourne
  sur le nœud, par son herdr ; la branche de carte naît et vit là.
- **La branche est poussée sur le remote** (GitHub) par l'agent du nœud, comme aujourd'hui. Le
  diff que montre le central est lu sur le nœud (`GET /api/node/…/diff`, par le `git.ts` du nœud),
  et est absent — pas faux — quand le nœud est injoignable.
- **L'intégration reste sur le central** : PR, lecture des checks, merge
  ([0027](./0027-the-board-merges-the-pr-when-github-will-not.md),
  [0029](./0029-the-board-reads-the-prs-checks-before-it-merges.md),
  [0036](./0036-github-not-answering-yet-is-a-wait-and-only-a-landing-files-the-card.md)) lisent
  GitHub, pas le disque du nœud. Le **merge direct**
  ([0043](./0043-a-repo-can-be-set-to-merge-direct-without-a-pr.md)) d'une carte de nœud exige une
  branche poussée et un clone du dépôt sur le central ; sans clone central, il est refusé et la carte
  passe par une PR.
- **Le nettoyage du worktree** est demandé au nœud à la fin de la carte, comme le central le fait
  aujourd'hui pour les siens ; un nœud injoignable le fera au prochain contact, ou l'opérateur à la
  main.
- **Sur un nœud Windows** : `core.autocrlf=false` (ou un `.gitattributes` `eol=lf`) sur le clone, et
  `git` dans le PATH **du serveur herdr**, pas seulement des panes (piège mesuré par la
  reconnaissance).

**Écarté — le central qui lit le disque du nœud** (partage réseau, `sshfs`, remote git sur Tailscale
SSH). Une deuxième porte vers chaque nœud, et un central qui ne marche plus quand le nœud dort.

**Écarté — le nœud qui pousse vers le clone du central.** Le central deviendrait un serveur git ; le
remote en est déjà un.

### 6. Livrables — le nœud est une boîte aux lettres, le central recopie

[ADR 0045](./0045-an-agent-publishes-its-deliverables-into-a-per-card-store-the-bridge-keeps.md) :
`publish_file` lit un fichier local et en envoie les octets au bridge, qui ne lit jamais un chemin
qu'on lui donne. Sur un nœud :

- **l'agent publie vers son bridge, celui du nœud** — son serveur MCP stdio parle au loopback de sa
  machine, comme partout ([ADR 0039](./0039-the-mcp-server-is-stdio-and-the-callers-pane-header-says-who-it-is.md)).
  Le nœud range le fichier sous `<stateDir>/deliverables/<cardId>/`, l'id de carte venant de la
  correspondance pane → carte que le central lui a donnée au lancement. Mêmes gardes que 0045 :
  plafond de 25 Mo, nom assaini, pas de SVG, provenance tirée de `x-collie-pane`.
- **le central recopie** : quand le snapshot d'un nœud annonce des livrables nouveaux pour une
  carte, il les tire (`GET`), les range dans son propre store par le même chemin qu'une
  publication locale (journal `deliverable.published`, avec le nom du nœud), puis **les efface du
  nœud** (`DELETE`). Le nœud n'est qu'une boîte aux lettres ; le store durable reste celui du
  central, dans sa sauvegarde.

**Écarté — le central qui relaie** (sert à la demande le fichier lu sur le nœud). La carte
dépendrait de la disponibilité du nœud des semaines après son merge — ce que 0045 existe pour
éviter.

**Écarté — le nœud qui pousse vers le central.** Le nœud connaîtrait le central (§ 1, ADR 0013).

### 7. Portage Windows — ce que la reconnaissance impose

- **API socket** : rien à faire, le named pipe est géré. Corriger `HERDR_API.md` (`C-c` accepté en
  0.9.5) et documenter le pipe, les sessions nommées, le piège du PATH.
- **Supervision : une tâche planifiée « à l'ouverture de session, uniquement si l'utilisateur est
  connecté », non élevée**, pour herdr puis le bridge, dans un environnement de logon frais.
  **Jamais un service** (session 0) et **jamais élevé** (COM sépare les niveaux d'intégrité : un
  client élevé ne s'attache pas au SolidWorks de l'utilisateur). Les panes restent en Windows
  PowerShell 5.1, qui a encore `Marshal.GetActiveObject`.
- **Scripts : `collie-board-ctl.sh` est réécrit en TypeScript sous Bun (`scripts/ctl.ts`)**, une
  source pour Linux, macOS et Windows, testée par `bun test`. Les actions de `herdr-plugin.toml` y
  pointent, avec des entrées `platforms = ["windows"]`. Le shell Bash reste sur Linux jusqu'à ce
  que `ctl.ts` le rattrape, puis disparaît ; il ne gagne plus de fonction d'ici là.
  `since-hook.sh` devient un `since-hook.ts`. `install-skill` copie ou fait une jonction, pas un
  symlink.
- **Chemins** : tout chemin sorti de git est normalisé à la frontière (`path.resolve`) et les
  chemins se comparent sans casse sur win32 — c'est le seul vrai bug de la reconnaissance (dépôt
  listé deux fois, garde de diff qui refuse). `galleryRoot()` suit `%TEMP%\claude` sur win32. Le
  `stateDir` reste `~/.local/state/collie-board` ; les modes `0600/0700` n'y ont pas d'effet et les
  ACL héritées d'un poste mono-utilisateur sont acceptées.
- **Installation** : Bun par `bun.sh/install.ps1` (winget ne pose pas `bunx` sans Developer Mode),
  pas de Developer Mode exigé, pas de WSL.
- **SolidWorks** : la chaîne réelle (ouvrir, `OpenDoc6`, `SaveAs` en image, écran verrouillé
  compris) reste à valider sur un poste équipé ; un premier lancement manuel passe la licence et les
  dialogues modaux.

**Écarté — un port PowerShell de `collie-board-ctl.sh`.** Plus court (4–6 j contre 6–8), mais il
garderait deux copies des ~330 lignes qui publient le `serve` et ne démontent que le mapping qu'elles
possèdent — la logique la plus sensible du script. Deux copies d'une règle de sécurité divergent.

**Écarté — WSL.** Tranché avant cet ADR : un agent dans WSL ne pilote pas le bureau Windows.

**Écarté — un nœud Windows supervisé comme service.** Session 0, pas de bureau : le but même du nœud
Windows y est impossible.

### 8. Hors périmètre

Dit explicitement, pour que personne n'y lise un `TODO` :

- **pas de nœud hébergé ni de service** : les machines sont celles de l'opérateur ;
- **pas de `funnel`**, ni d'autre porte gérée qu'un `tailscale serve` par machine ;
- **pas de central redondant**, ni de bascule, ni de plusieurs centraux ;
- **pas de nœud à nœud** : les nœuds ne se parlent pas ;
- **pas de board, d'orchestrateur ni de copilote sur un nœud** ; un agent de nœud ne file pas de
  carte (`create_card`, `notify`, `message_orchestrator` ne sont pas offerts par le MCP d'un nœud) —
  un nouvel ADR s'il le faut ;
- **pas de MCP distant** (streamable HTTP) : décision `aa86cefd` inchangée ;
- **pas de migration d'une carte en cours** d'un nœud à l'autre, ni de worktree partagé ;
- **pas de file d'attente de lancement** pour un nœud absent ;
- **pas de nœud macOS testé**, pas de nœud WSL, pas de SolidWorks élevé ni en session 0 ;
- **la gate d'un nœud** ([0020](./0020-the-gate-is-the-operators-command-run-before-the-lead.md)) :
  elle sera déclarée dans l'environnement, sur le nœud, jamais envoyée par le central — mais elle
  n'est pas dans les premiers lots ; d'ici là, une carte de nœud n'a pas de gate.

## Consequences

- **Coûts acceptés.** Deux fichiers de config à tenir à la main (`nodes.toml`, `node.toml`) et un
  jeton par nœud à faire tourner. Une carte de nœud n'a pas de diff ni d'action pendant une panne du
  nœud. Un nœud Windows exige un premier lancement manuel de SolidWorks et une session ouverte.
- **Ce qui reste vrai.** Bridge en loopback, une porte gérée par machine, `checkAccess` et la CSP
  inchangés pour le navigateur, le board seul dans la base du central, aucune boucle nouvelle, aucun
  `agent.start` direct, aucun chemin client lu par un bridge.
- **Ce qui justifierait de revenir dessus.** Un besoin qu'un nœud *initie* vers le central (une
  notification que seul le nœud voit, un agent de nœud qui file une carte) ; un deuxième central ;
  une cible que Tailscale ne joint pas. Chacun est un nouvel ADR, pas une extension de celui-ci.

## Découpage proposé

Les lots 2 et 3 se démontrent sur `arch-2` (Linux) sans attendre Windows ; les lots 0 et 1 se font
sur le poste Windows en parallèle.

| Lot | Contenu | Machine | Effort |
|---|---|---|---|
| **0 — Windows, le socle** | normalisation des chemins git (`/` → `\`, comparaison sans casse) ; `galleryRoot()` win32 ; `since-hook.ts` ; tests portables (fakes en `path.join`, symlinks sautés sans privilège, plus de `bash`/`mkdir`/`chmod`/`true`) ; doc d'installation (Bun, `autocrlf`, PATH du serveur herdr) ; `HERDR_API.md` | Windows | M (≈ 4 j) |
| **1 — `ctl.ts`** | `scripts/ctl.ts` sous Bun : `status`, `url`, `start`/`stop`, publication et démontage du `serve` possédé ; tâche planifiée à l'ouverture de session sur Windows, systemd sur Linux ; actions `platforms = ["windows"]` dans `herdr-plugin.toml` | Windows + Linux | L (6–8 j) |
| **2 — le rôle nœud** | `node.toml` ; rôle `node` (board éteint) ; jeton en temps constant devant `/api/node/*` ; routes `snapshot`, `pane`, `reply`, `keys`, `environments`, `launch` (par `launchAgent()`/`promptAndConfirm()`, environnement déclaré seulement), `diff`, fin de session | Linux (`arch-2`) | M |
| **3 — le central** | `nodes.toml` ; lecture des nœuds sur `engine.onUpdate`, bridée ; règle « injoignable = `disconnected` » ; panes qualifiés par nœud ; colonne `environment` sur la carte, choix à la création, lancement routé, refus motivé si absent ; réglages : nœuds, environnements, conflits de noms | Linux | M–L |
| **4 — git et livrables** | diff de carte lu sur le nœud ; nettoyage de worktree demandé au nœud ; merge direct refusé sans clone central ; boîte aux lettres de livrables : recopie et effacement côté nœud, journal avec le nom du nœud | Linux | M |
| **5 — Windows en vrai** | un nœud `windows-solidworks` de bout en bout depuis le central (démo de fin de phase) ; validation SolidWorks réelle (½ j sur un poste équipé) ; gate déclarée sur le nœud si le besoin est là | Windows | S–M |
