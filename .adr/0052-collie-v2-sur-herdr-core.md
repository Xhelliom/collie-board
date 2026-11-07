# 0052 — Collie V2 sur herdr-core : même cerveau, nouveau moteur, le projet au centre

**Statut : accepté (05/11), §4.2 amendé le 06/11 (lecture des deux moteurs)** — accepté par l'opérateur le 2026-11-05, la phase 5 soumise aux critères
de sortie du §8 et non à une date.

Sources : la sonde `HERDR_CORE_API.md` (hc 0.1.18, herdr-app 0.1.13, Claude Code 2.1.318, mesurée le
2026-11-05, branche `board/sonde-herdr-core-ce-que-collie-peut-faire-avec-h`) et le prototype
`herdr-app-mod/` (panneau projet + orchestrateur, lecture seule, #244). Les chiffres de surface
ci-dessous sont comptés sur ce dépôt au même jour.

## 1. Contexte

Collie Board parle aujourd'hui à **herdr 0.9.5** : une socket one-shot, des espaces/onglets/panes, et
un statut d'agent deviné en partie à l'écran. herdr-core (`hc`) est le successeur : un core par
utilisateur qui ne tient que des **terminaux**, une connexion persistante, des **labels** libres, et
surtout un **statut annoncé par l'agent lui-même** (OSC 7501). herdr-app est sa fenêtre de bureau,
extensible par des *mods* JS.

Ce que la sonde a mesuré et qui pèse sur la décision :

| fait | mesure | conséquence |
|---|---|---|
| Claude Code émet OSC 7501 sans réglage | `idle/working/done/blocked` + `kind`, `msg`, `title`, `turn` | la détection par écran de Claude peut tomber |
| `terminal.run` lance l'agent sans shell, tâche en argv | tâche en argv prise dès que Claude est prêt (1 essai, sans relance) ; piège : `hc wait` rend la main sur l'`idle` de démarrage | `launchAgent` perd 2 de ses 3 courses |
| prompt tapé mais non soumis | **1 sur 3** en parallèle, mais `send` le dit (`started:null`) | `promptAndConfirm` devient « envoyer, lire `started` » |
| écran de confiance, dossier neuf | le `Enter` aveugle répond **« No, exit »** → Claude quitte (`exit_code 1`) | bloquant, et **probablement déjà vrai sur 0.9** |
| `hc` n'a ni worktrees, ni espaces/onglets, ni notify, ni plugins | 31 méthodes OpenRPC, aucune `worktree.*`/`workspace.*` | worktrees en git (`bridge/git.ts`), regroupement par label/dépôt, service OS |
| `HERDR_PANE_ID` n'existe plus | remplacé par `HC_TERMINAL_ID` | la provenance `agent` (ADR 0010) en dépend : 11 fichiers à relayer |
| autres harnais (Codex, opencode, pi) | aucun statut sans OSC 7501 chez eux | V2 « Claude d'abord », repli écran pour les autres |

Surface touchée (comptée) : le bridge fait ~56 k lignes TS (tests compris) ; **30 fichiers** importent
`HerdrClient` (725 lignes), `state-engine.ts` 404, `cards.ts` 1 253 ; **11 fichiers bridge** et
**39 fichiers web** portent le modèle espace/onglet ; le code des pairs/nœuds (`remote-launch`,
`pairing`, `peer-herd`, `node`) fait 1 472 lignes. Le web fait ~44 k lignes.

Et un fait d'usage : ce que l'opérateur ouvre le plus, ce sont **le projet** (phase, lots, recette) et
**l'orchestrateur** qui le fait avancer. La liste des espaces et des panes est un détail de moteur que
l'UI expose parce que herdr 0.9 était rangé ainsi.

## 2. Cible

**Même cerveau, nouveau moteur, deux écrans.**

- **Cerveau inchangé** : cartes, lots, phases, lead, recette, journal, flux, notifications, API HTTP,
  MCP (`bridge/mcp.ts`), règles des ADR existants. Aucune donnée durable ne migre : `card` reste
  durable, `session` reste éphémère.
- **Moteur** : herdr-core à la place de herdr 0.9.5, derrière une interface de multiplexeur ; le
  bridge reste un service de l'OS (pas un terminal hc, `--keep` ne relance jamais la commande).
- **Deux écrans** : la **PWA téléphone** (inchangée dans son rôle, reste le premier client, seule voie
  hors du bureau) et un **mod herdr-app** côté bureau (le prototype #244), où les terminaux eux-mêmes
  sont déjà affichés par herdr-app — le mod n'a pas à les refaire.

## 3. Le projet et l'orchestrateur au centre

**Décision proposée : l'unité de l'interface devient le projet (un dépôt), et sa première vue est
« où en est-il, et que fait l'orchestrateur ».** Les terminaux sont des détails d'une carte ou de
l'orchestrateur, plus une entrée de navigation.

Ce que ça donne :

| | on garde | on allège / on retire |
|---|---|---|
| Accueil | la liste des **projets**, chacun avec phase, lots en cours, « N à tester », état de l'orchestrateur | la liste des espaces/onglets herdr (`/spaces`, `/space/:id`) — hc n'en a pas |
| Projet | phase, lots, roadmap, recette, l'orchestrateur (fil de messages + alertes) en tête | — |
| Carte | diff, journal, recette, livrables, commentaires de diff | le rangement « dans quel onglet » |
| Terminal d'agent | lecture, réponse, touches, historique du transcript | la détection `blocked` par écran pour Claude (`msg` d'OSC 7501 la remplace), `BLOCKED_TAIL_ROWS` ; l'ANSI passe par `terminal.attach` ou se perd (texte nu au début) |
| Notifications | push + cloche, une seule fente (ADR 0011) | le texte « bloqué » se lit dans `kind`+`msg`, plus de devinette |
| Bureau | le mod : projets, phase, lots, recette, orchestrateur, alertes | pas de miroir de terminal ni de board complet dans le mod : il renvoie vers herdr-app (terminal) ou la PWA (carte) |

Le mod reste **en lecture seule** tant que l'écriture ne passe pas par le même `checkAccess` que la
PWA ; ses premières écritures (lancer un lot, répondre à l'orchestrateur) sont une décision à part.

## 4. Options de mise en œuvre

### 4.1 Où vit le code

| option | pour | contre | coût estimé |
|---|---|---|---|
| **A. Nouveau dépôt** | table rase, pas de dette herdr 0.9 | perd l'historique, la CI, les 51 ADR comme contexte vivant, le board qui se développe avec lui-même ; deux produits à maintenir pendant la migration ; le fork amont (`UPSTREAM.md`) n'a plus de sens | élevé, et une coupure nette de l'usage quotidien |
| **B. Branche longue `v2`** | `main` intact | c'est exactement le conflit qu'ADR 0016 a supprimé pour la version, en pire : 30 fichiers qui bougent sur `main` chaque jour ; la release ne se coupe que sur `main` | élevé, croît chaque semaine |
| **C. Adaptateur hc à côté de l'actuel, dans `bridge/mux/`, sur `main`** (recommandé) | livré par petites cartes, chaque phase utilisable ; bascule par config ; repli immédiat sur 0.9 ; cohérent avec « nouveau comportement dans de nouveaux fichiers » | une interface `Mux` à extraire de `HerdrClient` d'abord ; deux implémentations à tester pendant la coexistence | moyen, étalé |

`bridge/mux/` n'existe pas encore : il contiendrait `mux.ts` (l'interface, taillée sur ce que les
30 consommateurs utilisent vraiment), `herdr09.ts` (l'actuel `HerdrClient` derrière elle) et `hc.ts`.

### 4.2 Coexistence herdr 0.9 et hc

- ~~Un seul moteur actif par bridge, choisi par config (`mux = "herdr" | "hc"`), défaut `herdr` jusqu'à
  la phase 4. Pas de bridge qui parle aux deux à la fois : deux sources pour un même snapshot, c'est
  deux vérités sur « le troupeau ».~~ ~~Les agents déjà lancés sous 0.9 finissent sous 0.9 ; la bascule
  se fait projet vide (aucun lot en cours), comme une mise à jour.~~
- **Amendé le 2026-11-06 : le bridge lit les deux moteurs à la fois.** La crainte des « deux vérités »
  ne tient pas : **chaque pane appartient à un seul moteur**, donc un même pane n'a jamais deux
  sources. Un `CompositeMux` (`bridge/mux/composite.ts`) fusionne les deux troupeaux ; le moteur d'un
  pane se lit sur son id (hc : `t<n>` et l'espace `hc` ; 0.9 : `w…`), donc les ids 0.9 déjà stockés
  (cartes, sessions, URLs `/pane/<id>`) ne changent pas. Toute action va au moteur propriétaire ;
  seul un **nouveau** lancement suit la config (`mux = "herdr09" | "hc"`, ~~défaut `herdr09`~~ —
  **amendé le 2026-11-07, phase 4 : défaut `auto`**, hc tant que son core répond au dernier snapshot,
  herdr 0.9 sinon, et le bouton Démarrer de la carte dit ce repli ; `herdr09`/`hc` épinglent un moteur). Un moteur
  absent ou déconnecté ne vide pas l'autre (ses derniers panes tiennent une minute, le temps d'un
  hoquet) ; seuls les deux en panne font un snapshot `disconnected`. La migration se fait **agent par
  agent** — un agent 0.9 finit sous 0.9 pendant que les nouveaux naissent sous hc — au lieu d'une
  bascule projet vide.
- **Le core hc est démarré par herdr-app ou la session de bureau, jamais par un agent ni par le
  bridge** (amendé le 2026-11-07) : il transmet son environnement, dont `CLAUDE_CODE_CHILD_SESSION`,
  qui coupe les transcripts Claude (HERDR_CORE_API.md §8).
- Le manifeste `herdr-plugin.toml` et ses 9 actions restent tant que 0.9 est supporté ; ensuite
  `scripts/ctl.ts` + un lanceur `collie-board <action>` (sonde §5), version canonique dans
  `package.json` — ce qui amende ADR 0016 et la règle « Update notice » de CLAUDE.md (ADR à écrire à ce
  moment-là).

### 4.3 Ce que hc remplace chez nous

| chez nous | devient | reste à nous |
|---|---|---|
| nœuds d'ADR 0046 (`remote-launch.ts`) | `hc machine` + `run --on` (shell distant sans board) | le droit explicite pour l'exposer au téléphone : `machine add` contourne `checkAccess` |
| pairs (ADR 0048/0049/0051) | **rien** : un pair a son board ; `hc machine` n'en a pas | synchro git du board, jeton de pair, `launch` par pair |
| détection d'état (écran, hooks herdr, `BLOCKED_TAIL_ROWS`) | OSC 7501 (`status`, `turn`, `title`) | le repli écran pour les harnais sans OSC 7501 |
| `launchAgent` (3 courses) | `terminal.run {argv, cwd, labels}` | répondre à l'écran de confiance (`down enter`) ou pré-approuver le dossier |
| `promptAndConfirm` | `terminal.send {if:"idle"}` → `started` | un `Enter` si `started:null` et `reported:true` |
| retrouver la carte par nom de pane / `worktree.open` | label `collie.card=<id>` filtré à la source | — |
| sous-agents lus dans les transcripts | `children_of` | `--no-notify` (sinon hc tape une note qui coûte un tour au parent) |
| worktrees herdr | — | `git worktree add/remove` dans `bridge/git.ts` |
| `agent.notify` | — | push + cloche |

## 5. Risques

| risque | probabilité | impact | parade |
|---|---|---|---|
| **hc en 0.1.x** : 18 patchs en 0.1, protocole qui peut casser (déjà vu : `labels` objet vs liste) | haute | moyen — l'adaptateur casse, pas le cerveau | tout l'accès hc dans `bridge/mux/hc.ts` ; version de hc vérifiée au `hello` et affichée ; 0.9 reste le repli jusqu'à la phase 5 |
| **Statut de Claude Code** : OSC 7501 est une fonction non documentée de Claude Code (lue dans le binaire 2.1.318), qui sonde le terminal et peut changer ; le défaut de l'écran de confiance a déjà changé (« No, exit ») | moyenne | haut — sans statut, le lead et l'orchestrateur sont aveugles | garder le repli écran derrière la même interface ; un test de bout en bout « lancer, attendre `turn ≥ 1` » à chaque version de Claude ; pré-approuver le dossier du worktree |
| **Téléphone hors herdr-app** : herdr-app est un client de bureau ; tout ce qui n'existe que dans un mod est invisible du téléphone | certaine | haut si on l'oublie | règle : le mod ne fait que lire l'API et renvoyer ; toute capacité nouvelle naît dans le bridge + PWA, jamais dans le mod seul |
| autres harnais muets | certaine | moyen (Codex/opencode moins bien suivis) | repli écran ; `adapters/agents.toml` n'affirme un statut qu'après mesure, comme `context` |
| modèle espace/onglet (11 fichiers bridge, 39 web) plus gros que prévu | moyenne | moyen | phase 3 dédiée, après que le moteur tourne ; le projet devient la clé, pas l'onglet |
| provenance perdue (`HERDR_PANE_ID` → `HC_TERMINAL_ID`) | haute si oublié | haut — un agent devient `human` (ADR 0010) | relayer les deux pendant la coexistence ; `skill.test.ts`-like : un test qui cherche `HERDR_PANE_ID` sans `HC_TERMINAL_ID` |

## 6. Décision proposée

1. Option **C** : un adaptateur `bridge/mux/` sur `main`, hc derrière une config, 0.9 par défaut
   jusqu'à ce que hc tienne une semaine d'usage réel. **Amendé le 2026-11-07 (phase 4)** : hc est le défaut des
   nouveaux lancements dès que son core répond, 0.9 le repli (§4.2).
2. L'interface se recentre sur **le projet et l'orchestrateur** (§3), sur les deux écrans.
3. Le mod herdr-app est un **second écran de lecture** ; le téléphone reste le client complet.
4. Corriger l'écran de confiance **sur 0.9 d'abord**, indépendamment de la V2.

## 7. Nom

| nom | pour | contre |
|---|---|---|
| **Kelpie** | un autre chien de berger : même famille que Collie, marque une nouvelle génération ; court | un nom de plus à apprendre ; plugin id, unité systemd et chemins à renommer |
| **Collie Board 2** (garder le nom, version majeure `1.0.0`) | rien à renommer ; la V2 est une version, pas un produit | ne dit pas que le moteur a changé |
| **Collie Desk** | dit les deux écrans (téléphone + bureau) | met l'accent sur le bureau alors que le téléphone reste premier |

Recommandation : **Collie Board 2** tant que la coexistence dure (pas de renommage pendant une
migration), et la question du nom rouverte à la phase 5.

## 8. Découpage en phases

Chaque phase est utilisable seule et réversible par config.

| phase | contenu | sortie vérifiable |
|---|---|---|
| **0 — Prérequis sur l'actuel** | vérifier et corriger l'écran de confiance sous 0.9 (pré-approbation du dossier ou `down enter`) | une carte lancée sur un worktree neuf démarre sans quitter |
| **1 — Interface `Mux`** | extraire de `HerdrClient` l'interface utilisée par les 30 consommateurs ; `herdr09.ts` derrière ; aucun changement de comportement | tests verts, diff de comportement nul |
| **2 — hc en lecture** | `hc.ts` : snapshot, `events.subscribe`, statut OSC 7501, `terminal.read` ; bridge en `mux = "hc"` sur une machine de test | la PWA affiche le troupeau hc et ses statuts, sans rien lancer |
| **3 — hc en écriture** | `terminal.run` + labels `collie.card`, worktrees en git, `send {if:"idle"}`, `HC_TERMINAL_ID` relayé, sous-agents par `children_of` | une carte va de « lancer » à « PR » sous hc |
| **4 — Le projet au centre** | accueil par projets, espaces/onglets retirés de l'UI, mod herdr-app branché sur les mêmes vues ; hc devient le défaut | recette faite sur téléphone et dans herdr-app |
| **5 — Sortie de herdr 0.9** (sur critères, sans date — voir ci-dessous) | retrait de `herdr09.ts`, de `herdr-plugin.toml`, `ctl.ts` + lanceur `collie-board`, version canonique dans `package.json` (ADR amendant 0016 et la règle « Update notice ») ; nœuds d'ADR 0046 sur `hc machine` ; nom tranché | plus aucune référence à la socket herdr 0.9 |

**Critères de sortie de la phase 5.** Aucune date : on ne retire la couche herdr 0.9 que quand les
quatre critères tiennent ensemble :

1. le protocole hc **n'a pas cassé depuis 2 mois** ;
2. **toutes les machines de l'opérateur tournent sur hc** — ici, dev, Dell, Windows ;
3. les harnais utilisés hors Claude **annoncent leur statut (OSC 7501)**, ou gardent l'adaptateur
   écran comme repli ;
4. herdr 0.9 **ne reçoit plus de correctifs**.

Tant qu'un critère manque, **les deux moteurs coexistent derrière l'interface `Mux`, choisie par
machine** (`mux = "hc"` ou `"herdr"` dans la config de chaque bridge).

**Windows.** herdr-app et herdr-core existent aussi sous Windows, avec un *named pipe* à la place de
la socket Unix. L'adaptateur `hc.ts` doit donc ouvrir l'un ou l'autre selon la plateforme ; ce que
le named pipe change (chemin, permissions, `events.subscribe` en flux) est **à mesurer en phase 2**,
sur la machine Windows, avant que le critère 2 puisse tenir.

## Conséquences

- Le cerveau ne bouge pas : aucune migration de base, aucun ADR de comportement rouvert sauf 0016
  (version canonique) à la phase 5 et 0046 (nœuds) à la même phase.
- La règle « garder la surface amont étroite » devient caduque pour le moteur : à la phase 5 le fork
  ne parle plus le protocole de l'amont. `UPSTREAM.md` devra dire ce qui reste partageable.
- À revoir si : hc reste en 0.1.x sans stabiliser son protocole au-delà de la phase 2, ou Claude Code
  cesse d'émettre OSC 7501 — dans ces deux cas, rester sur 0.9 est le bon choix et cet ADR passe en
  rejeté.
