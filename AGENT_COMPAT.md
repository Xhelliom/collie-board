# Isofonctionnalité par agent — Cursor et Codex face à Claude Code

> Document en français : c'est la langue de la demande, comme [`UI_AUDIT.md`](./UI_AUDIT.md).
> Le reste du dépôt reste en anglais.
> Rédigé le 2026-08-24 sur la branche `board/audit-isofonctionnalite-cursor-codex`, contre
> Collie Board 0.113.1 et herdr 0.8.0.
>
> **Ce document n'implémente rien et ne modifie aucun code applicatif.** C'est un constat :
> où collie-board sait quel agent il pilote, ce que Cursor et Codex offrent en face, et ce qui
> reste sur le carreau. Chaque point cite `fichier:ligne` pour être vérifiable et contestable
> séparément.

## Méthode et niveaux de preuve

Trois sources, distinguées partout dans le texte parce qu'elles ne valent pas la même chose :

| Marque | Ce que ça veut dire |
|---|---|
| **[vérifié]** | Constaté sur cette machine (lecture de code, `herdr` en direct, fichiers sur disque). |
| **[documenté]** | Lu dans la doc ou les sources officielles de l'agent (via `ctx7`), pas exécuté ici. |
| **[à vérifier]** | Déduction plausible, non confirmée. Ne pas la traiter comme un fait. |

Ce qui n'a **pas** été fait : aucun agent Cursor ni Codex n'a été lancé dans un pane herdr.
`codex` et `cursor-agent` ne sont pas installés sur cette machine **[vérifié]** — seul l'IDE Cursor
l'est (`/usr/bin/cursor`). Tout ce qui concerne le comportement d'un pane Cursor/Codex *en
fonctionnement* est donc au mieux **[documenté]**. Les traces disque de Cursor examinées plus bas
proviennent de l'agent Cursor de l'IDE, pas de sa CLI ; l'hypothèse qu'elles partagent le même
magasin est **[à vérifier]**.

## Le socle qui est déjà agnostique

Avant la liste des points d'accroche, il faut dire ce qui n'en est pas un — sinon l'audit
surestime le travail d'un facteur dix.

**Herdr normalise la détection et l'état de 21 agents sans configuration.** `herdr agent start
--kind` accepte `pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode,
copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, maki` **[vérifié]**, et
`herdr integration install` a une intégration dédiée pour `codex` **et** pour `cursor` **[vérifié]**.
`agent_status ∈ {idle, working, blocked, done, unknown}` est produit par herdr, pas par
collie-board : `bridge/state-engine.ts` ne fait **aucune** inférence d'état à partir du texte du
pane.

Sont donc agnostiques par construction, pour Cursor comme pour Codex, sans une ligne de code :

- le tri « NEEDS YOU » et tout le cycle idle/working/blocked/done ;
- les notifications push et leur regroupement (`bridge/notifications.ts`) ;
- `pane.send_keys` et le bandeau de touches spéciales (`web/src/components/nav-tray.tsx:164-180`) ;
- l'envoi de texte libre et la touche de soumission (`COLLIE_BOARD_SUBMIT_KEYS`, défaut `Enter`,
  `bridge/config.ts:278`) ;
- tout `bridge/git.ts` : diff, branche, worktree, merge, PR, nettoyage ;
- le modèle de carte, les dépendances, les conteneurs, le stockage SQLite ;
- le contrat de sortie du copilote (« écris ce JSON dans ce fichier ») et celui du handoff/wrapup
  (« écris ce fichier dans ton cwd ») ;
- la sécurité : porte d'entrée unique, garde d'origine, CSP — rien là-dedans ne connaît d'agent.

Le reste de ce document ne parle que de ce qui **sort** de ce socle.

---

## Les points d'accroche spécifiques à l'agent

Quinze points. Ils sont classés par ordre d'importance pour le produit, pas par ordre
d'apparition dans le code.

### 1. Les grammaires de TUI — les blocs interactifs

**Où.** `web/src/lib/harness/registry.ts:13` : `ADAPTERS` est construit à partir de la seule liste
`[claudeAdapter]`. Tout agent absent du registre tombe sur le miroir terminal brut
(`web/src/lib/harness/index.ts:17`).

**Ce qui en dépend.** Les quatre dialogues remontés en boutons natifs — `prompt-select`
(permissions), `wizard`, `preview-select`, `multi-select` — plus le retrait du chrome
(`stripChrome`), la barre de statut re-surfacée et la récupération d'un brouillon resté dans la
boîte de saisie. C'est *le* cœur du produit mobile : « ne pas montrer un écran brut »
(`ARCHITECTURE.md` §4).

**Cursor.** Absent. Sa CLI a bien un dialogue d'approbation avant chaque commande shell
**[documenté]** et une rotation de modes en `Shift+Tab` **[documenté]** — donc de la matière à
remonter, mais aucun détecteur écrit, aucune fixture capturée.

**Codex.** Absent. Même situation : le TUI a ses menus et son sélecteur d'approbation
**[documenté]**, rien n'est modélisé côté collie-board.

**Ce qu'il faudrait.** Le chemin est déjà balisé et documenté :
[`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md) décrit l'échelle Tier 0 → Tier 2, le
workflow fixtures-first (`scripts/capture-fixture.sh`), la barrière CI
(`describeAdapterConformance`, `web/src/lib/harness/conformance.ts`) et la clôture de capacité
(`web/src/lib/harness/fence.test.ts`). Le seuil Tier 2 — celui où les boutons tapent vraiment dans
un terminal — exige un corpus de fixtures daté, des notes de chorégraphie, la conformance au vert
et une vérification manuelle contre un vrai pane. C'est le poste de travail le plus lourd de tout
le portage, et c'est délibéré.

### 2. Le garde d'envoi de réponse — le point de sécurité

**Où.** `web/src/lib/reply-action.ts:78` : `if (!adapter) return oneShot(args);`

**Ce que ça veut dire.** Le garde qui corrige l'issue #34 — taper le texte, vérifier par lecture
fraîche du pane qu'il est bien arrivé dans la boîte de saisie, **et seulement alors** envoyer la
touche de soumission — repose sur `adapter.extractInputDraft`. Sans adaptateur, collie-board
retombe volontairement sur l'ancien comportement : un seul appel qui tape **et** soumet à l'aveugle.

Le commentaire au-dessus assume ce choix (une heuristique sur le miroir brut aurait un faux négatif
pire que le bug : une saisie sans écho — un prompt `sudo` — ne montrerait jamais le texte et la
soumission serait retenue pour toujours). Mais la conséquence est nette : **sur un pane Cursor ou
Codex, le mode d'échec de l'issue #34 n'est pas gardé.** Si un dialogue d'approbation a le focus,
le texte est avalé et la touche de soumission **répond au dialogue** — c'est-à-dire approuve
l'option surlignée. Or Cursor demande une approbation avant chaque commande shell **[documenté]** et
Codex a un dialogue de confiance de dossier au premier lancement **[documenté]**.

Ce n'est pas une régression introduite par un portage : c'est l'état actuel pour tout agent non
Claude, y compris `opencode` et `pi` qui sont déjà catalogués ailleurs dans le code. Mais un portage
qui déclarerait Cursor ou Codex « supporté » sans adaptateur ferait de ce trou une fonctionnalité
annoncée.

### 3. La jauge de contexte (`ctxPct`)

**Où.** `bridge/transcript.ts:1117` (`latestUsage`), gardée par `bridge/context.ts:118`
(`adapterFor(this.adapters, pane.agent).context`), table dans `adapters/agents.toml`.

**Ce qui en dépend.** Le pourcentage sur la carte, le `$ctx` repoussé dans la sidebar herdr via
`pane.report_metadata`, et le seuil qui *suggère* un handoff (`COLLIE_BOARD_HANDOFF_PCT`, défaut
70). `latestUsage` exige une ligne `type:"assistant"` portant
`message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens}`.

**Cursor.** Rien à lire. Les transcripts examinés localement ne contiennent **aucune** occurrence
du mot `usage`, ni aucun champ de comptage de tokens **[vérifié]** (46 lignes analysées sur un
transcript réel, plus une recherche sur le champ). La jauge est structurellement impossible depuis
cette source.

**Codex.** Les tokens existent : le rollout porte des lignes `EventMsg` de type `token_count` avec
`total_token_usage` et `model_context_window` **[documenté]**. Mais la forme n'a rien à voir avec
celle que `latestUsage` sait lire, et le fichier n'est pas au même endroit (voir §4).

**Piste transverse non explorée.** `herdr agent list` renvoie déjà `tokens: {"ctx":"15%"}` sur les
panes claude de cette machine **[vérifié]** — c'est précisément ce que collie-board y publie
lui-même. Si l'intégration herdr de Codex ou de Cursor publiait son propre `$ctx`, la jauge
pourrait venir de là plutôt que d'un parseur de transcript, et le point deviendrait agnostique.
**[à vérifier]** — cela n'a pas été testé et l'intégration n'a pas été installée (elle écrit dans
la config de l'utilisateur).

**État de la table.** `adapters/agents.toml` déclare `context = false` pour `codex`, ce qui est
correct et honnête. **`cursor` n'y figure pas du tout** : il tombe sur `unknownAdapter()`
(`bridge/adapters.ts:53`), qui met tout à `false`. C'est le bon défaut — la règle « une jauge qui
peut se tromper est pire que pas de jauge » est respectée dans les deux cas.

### 4. La lecture du transcript — l'historique de pane

**Où.** `bridge/transcript.ts`. Racine unique `~/.claude/projects` (`bridge/config.ts:277`,
surchargeable par `COLLIE_BOARD_TRANSCRIPT_ROOT`), mangling `cwd.replace(/[^A-Za-z0-9]/g, "-")`
(`bridge/transcript.ts:145`), fichier `<uuid>.jsonl`, et un parseur qui **exige**
`row.type === "user" | "assistant"` (`bridge/transcript.ts:332`).

**Ce qui en dépend.** L'onglet Historique du pane (`bridge/server.ts:653`), la galerie d'images du
transcript (`toolImagePath`), et le premier étage du sous-titre de notification
(`bridge/notify-subtitle.ts`). Rappel : ce n'est pas un confort — un pane d'agent tourne sur l'écran
alterné, qui n'a **aucun** scrollback, donc le transcript disque est la seule mémoire longue.

**Cursor.** Le format est étonnamment proche, et pourtant incompatible sur trois points **[vérifié]** :

| | Claude Code | Cursor |
|---|---|---|
| Chemin | `~/.claude/projects/<cwd manglé>/<uuid>.jsonl` | `~/.cursor/projects/<cwd manglé>/agent-transcripts/<uuid>/<uuid>.jsonl` |
| Mangling | `/home/x/y` → `-home-x-y` (tiret initial) | `/home/x/y` → `home-x-y` (sans tiret initial) |
| Discriminant | `{"type":"user"…}` / `{"type":"assistant"…}` | `{"role":"user","message":{…}}` (pas de `type`) |
| Contenu | `message.content: [{type:"text"|"tool_use"|"thinking"}]` | `message.content: [{type:"text"|"tool_use"}]` — **identique** |
| Fin de tour | (implicite) | `{"type":"turn_ended","status":"success"}` |
| Usage tokens | `message.usage` | absent |

Concrètement : `COLLIE_BOARD_TRANSCRIPT_ROOT` ne suffit pas, parce que la **profondeur** du chemin
diffère (un dossier `agent-transcripts/<uuid>/` de plus) et que le mangling n'est pas le même. Et
même avec le bon fichier, `parseTranscript` sauterait **toutes** les lignes faute de champ `type`,
et rendrait un historique vide. L'adaptation est petite — le modèle de contenu est le même — mais
elle est réelle.

**Codex.** Rien ne correspond **[documenté]** : `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`,
avec des lignes `{"type": <tag>, "payload": {…}}` où `<tag> ∈ {session_meta, response_item,
turn_context, event_msg, compacted, world_state, …}`. Ni l'arborescence (par date, pas par cwd) ni la
forme des lignes. Pire pour la résolution : `resolveWithoutSession()` retrouve aujourd'hui un
transcript **par le cwd** ; les rollouts Codex ne sont pas rangés par cwd — le cwd est *à
l'intérieur* de `turn_context`/`session_meta`. Le repli n'a donc rien où s'accrocher.

### 5. `agent_session` — le lien pane ↔ transcript, et un bug de portabilité concret

**Où.** `bridge/state-engine.ts:222` :
`...(p.agent_session?.kind === "id" && typeof p.agent_session.value === "string" ? … : {})`

**Le problème.** Le schéma herdr définit `AgentSessionRefKind` comme l'énumération **`["id",
"path"]`** **[vérifié]** (`herdr api schema`), et le protocole de report expose bien les deux :
`herdr pane report-agent … [--agent-session-id ID] [--agent-session-path PATH]` **[vérifié]**.
Collie-board **ignore silencieusement** le cas `path`.

**Pourquoi ça compte pour Codex.** Une session Codex est un fichier — `rollout-<ts>-<uuid>.jsonl`
rangé par date. C'est exactement le genre de session qu'une intégration désignerait par chemin
plutôt que par identifiant. Si l'intégration herdr de Codex rapporte un `--agent-session-path`,
collie-board le jette et retombe sur le repli par cwd, qui ne marche pas pour Codex (§4).

**Pour Cursor**, l'identifiant de chat est un uuid (`agent --resume="chat-id-here"` **[documenté]**,
et les fichiers sur disque sont nommés par uuid **[vérifié]**), donc `kind: "id"` est le cas
probable **[à vérifier]**.

C'est le point le moins cher de toute la liste : accepter `kind === "path"` et transporter le chemin
jusqu'à `pageAt()` — qui existe déjà et prend un chemin (`bridge/notify-subtitle.ts` s'en sert).

### 6. La jauge de quota `/usage`

**Où.** `bridge/usage.ts` en entier, plus `web/src/components/usage-gauge.tsx` et
`web/src/lib/board.ts:800-825` (`ClaudeUsage`, nommé ainsi jusque dans le type).

**Le mécanisme.** `claude -p "/usage"` en sous-processus, puis une regex sur le panneau texte. Le
raisonnement de l'[ADR 0009](./.adr/0009-the-usage-gauge-shells-out-to-the-cli-not-the-copilot.md)
est que la commande est rendue **localement**, donc lire son quota ne consomme pas de quota.

**Cursor.** Pas d'équivalent. `agent status` concerne l'authentification, pas la consommation
**[documenté]**.

**Codex.** `/status` affiche bien la consommation de tokens **[documenté]**, mais c'est une commande
de TUI. `codex exec` lance un vrai tour de modèle — ce qui casse précisément la prémisse de
l'ADR 0009. Aucun équivalent headless connu.

**Verdict.** Impossible pour les deux. Mais la dégradation est propre et déjà écrite : pas de
binaire, pas de panneau reconnaissable, timeout → l'endpoint répond `null` et le téléphone
n'affiche pas de jauge.

### 7. La galerie d'images

**Où.** `bridge/gallery.ts:51` : `galleryRoot()` renvoie `/tmp/claude-<uid>`, **non configurable
délibérément** (posture de sécurité : exactement une racine, aucun composant fourni par le client).

**Ce que c'est.** Le répertoire scratchpad de Claude Code, où les images générées atterrissent.

**Cursor.** Stocke ses images ailleurs — `~/.cursor/projects/<projet>/assets/image-<uuid>.png`
**[vérifié]**. Incompatible avec une racine fixée en dur.

**Codex.** Convention inconnue **[à vérifier]**.

**Verdict.** Impossible pour les deux sans toucher à la racine — et la toucher est un arbitrage de
sécurité, pas un simple paramètre. `toolImagePath()` dans le transcript en dépend aussi.

### 8. Le nom de session (`/rename`)

**Où.** `bridge/state-engine.ts:39` (`extractClaudeSessionName`) et `:335`
(`agents.filter((a) => a.agent === "claude")`).

**Le mécanisme.** Claude dessine le nom de session **dans** le filet horizontal juste au-dessus du
prompt `❯`. Le parseur n'accepte ce filet que si la ligne suivante est le prompt — zéro faux
positif. Le commentaire du code le dit déjà : « Claude-only ; other harnesses never set it. »

**Cursor.** Pas de `/rename` connu **[documenté]** ; les conversations sont désignées par id de chat.

**Codex.** `codex resume` accepte « un id de session (UUID) **ou un nom de session** » **[documenté]** —
donc la notion de nom existe, mais rien ne dit qu'il est peint dans le rail du prompt.

**Verdict.** Dégradé, sans conséquence : la carte retombe sur le label de pane herdr puis sur le nom
d'agent (`web/src/lib/types.ts:67`). Aucun code à écrire si on l'accepte tel quel.

### 9. La commande de reset de contexte du copilote

**Où.** `bridge/copilot.ts:763` (`this.cfg.boardCopilotClear || this.adapter.clear`), table dans
`adapters/agents.toml`.

**L'incohérence.** `adapters/agents.toml` déclare `clear = ""` pour `codex`, avec un commentaire
honnête (« placeholder jusqu'à ce que quelqu'un le vérifie contre la vraie CLI »). Mais
`web/src/lib/agent-commands.ts:83` et `:86` listent déjà `/clear` **et** `/new` pour Codex, sourcés de la
doc officielle. Les tooltips Codex confirment `/new` **[documenté]**. Les deux tables du dépôt se
contredisent.

**Cursor.** Absent des deux tables. `/model`, `/vim`, `/resume` sont documentés **[documenté]** ; la
commande de reset n'a pas été confirmée.

**Conséquence si on ne fait rien.** Le copilote ne se réinitialise jamais et son contexte se
remplit. C'est borné (chaque prompt du copilote est auto-suffisant) mais pas gratuit.
`COLLIE_BOARD_COPILOT_CLEAR` permet déjà de contourner sans toucher au code.

### 10. Le catalogue de commandes slash

**Où.** `web/src/lib/agent-commands.ts:163` (`CATALOG`), avec un repli tolérant aux variantes
(`claude-code`, `opencode-dev`…).

**Codex.** **Déjà là** : 32 entrées curées depuis `developers.openai.com/codex` et `openai/codex`.
Iso sans travail. À revérifier tout de même : le catalogue date, et `/clear` y figure alors que les
tooltips actuels de Codex ne listent que `/new` et `/compact` **[documenté]**.

**Cursor.** **Absent.** `commandsFor()` renvoie `[]` et l'UI **masque le bouton commandes**. C'est
une perte visible sur téléphone — la palette de commandes est une des rares façons confortables de
piloter un agent sans clavier physique.

### 11. L'icône d'agent

**Où.** `web/src/components/agent-icon-data.ts:18` : `AGENT_BRANDS` contient `claude`, `codex`,
`pi`, `opencode`.

**Codex.** Présent. **Cursor.** Absent → tuile d'initiales « CU ». Purement cosmétique, mais c'est
visible sur chaque tuile de carte et dans la sidebar.

### 12. La livraison du prompt et la modale de confiance

**Où.** `bridge/cards.ts:566` (`promptAndConfirm`) et son en-tête, qui documente deux courses
vérifiées en direct.

**Le mécanisme.** Le test « le prompt a atterri » est `agent_status ∈ {working, blocked}` — donc
herdr, donc agnostique. Le premier rattrapage (un `Enter` si le texte est resté non soumis) est
générique. Le second (`firstAfterLaunch`, re-envoi complet) vise une modale de confiance qui avale
le prompt entier au premier lancement dans un répertoire neuf — ce qui arrive à **chaque** carte,
puisque chaque carte a un worktree neuf.

**Codex.** Même classe de problème, confirmée : le TUI affiche « Do you trust the contents of this
directory? » au premier lancement **[documenté]**. Le rattrapage `firstAfterLaunch` s'applique tel
quel.

**Cursor.** Une approbation est demandée avant chaque commande shell **[documenté]** ; l'existence
d'une modale de confiance *au lancement* n'est pas confirmée **[à vérifier]**.

**Verdict.** Iso pour les deux — sous réserve que herdr fasse bien passer le statut à `working`, ce
qui dépend de la qualité de la détection herdr pour ces agents, pas de collie-board.

### 13. Le lancement — `agent.start --kind`

**Où.** `bridge/cards.ts:665` : `const kind = card.agentKind ?? cfg.boardAgentKind;` avec
`boardAgentKind` défaut `"claude"` (`bridge/config.ts:290`, env `COLLIE_BOARD_AGENT_KIND`).

**Cursor et Codex.** Les deux `kind` sont acceptés par herdr 0.8.0 **[vérifié]**. Iso.

**La vraie limite est ailleurs.** `agentKind` est bien dans l'allowlist de l'API
(`bridge/board-routes.ts:105`, create **et** patch), mais **aucun contrôle d'interface ne le
règle** : `web/src/routes/card.tsx:1451` ne fait que l'afficher. En pratique un déploiement a donc
**un seul agent**, fixé par variable d'environnement, sauf à passer par l'API à la main. Un board
mixte Claude + Codex est possible côté données, invisible côté UI.

### 14. Le sous-titre de notification

**Où.** `bridge/notify-subtitle.ts`. Deux étages : (1) la dernière ligne assistant du transcript,
verbatim, ~10-60 ms ; (2) une reformulation par le copilote.

**Verdict.** L'étage 1 dépend entièrement de §4 → indisponible pour Cursor et Codex tels quels.
L'étage 2 est agnostique mais optionnel et désactivé par défaut. Dégradé : le push garde son corps
de base (`repo · titre de carte`), qui est déjà la valeur par défaut.

### 15. Les réponses rapides

**Où.** `web/src/components/quick-actions.tsx:9-10` : `["yes","no"]` et
`["continue","commit and push","retry","skip"]`.

**Verdict.** Iso, parce que ce ne sont que des textes envoyés tels quels. `ARCHITECTURE.md` §4 le
dit déjà : « les réponses rapides sont des heuristiques, pas des garanties », avec toujours le repli
« envoie exactement ce que je tape ». Elles dégradent aussi mal sur Claude que sur Cursor ou Codex.

---

## Verdict — Cursor

**Marche tel quel (isofonctionnel) :** lancement de carte (`--kind cursor`), worktree et branche,
statuts idle/working/blocked/done, notifications push, miroir terminal en couleur, bandeau de
touches spéciales, envoi de texte libre, réponses rapides, tout `bridge/git.ts` (diff, merge, PR,
nettoyage), handoff et wrapup (le contrat est un fichier sur disque), copilote, dépendances entre
cartes.

**Marche en dégradé :**

| Fonction | Ce qu'on perd |
|---|---|
| Dialogues remontés en boutons | Tout. Miroir brut uniquement (§1). |
| Garde d'envoi de réponse | Retour au send aveugle — **le mode d'échec #34 est ouvert** (§2). |
| Historique de pane | Vide. Le transcript existe et sa forme est proche, mais chemin + discriminant diffèrent (§4). |
| Sous-titre de notification | Étage 1 perdu ; corps de push par défaut (§14). |
| Nom de session | Retombe sur le label de pane (§8). |
| Icône d'agent | Tuile d'initiales (§11). |

**Ne marche pas du tout :** jauge de contexte (§3 — aucune donnée d'usage dans le transcript, ce
n'est pas un manque de code mais un manque de source), jauge de quota (§6), galerie d'images (§7 —
racine fixée en dur, arbitrage de sécurité), palette de commandes slash (§10 — le bouton est
carrément masqué).

**En une phrase.** Cursor donne un board pleinement *fonctionnel* mais pas *confortable au
téléphone* : on garde tout ce qui décide (lancer, suivre, merger, classer) et on perd tout ce qui
évite de taper (boutons de dialogue, palette de commandes, historique). Le point qui doit être levé
avant toute annonce de support, c'est §2 — pas §1.

## Verdict — Codex

**Marche tel quel :** la même base que Cursor, plus deux acquis qui manquent à Cursor — le
**catalogue de commandes slash** (32 entrées déjà écrites, §10) et l'**icône de marque** (§11).
Le rattrapage de modale de confiance (§12) est confirmé pertinent pour Codex.

**Marche en dégradé :**

| Fonction | Ce qu'on perd |
|---|---|
| Dialogues remontés en boutons | Tout. Miroir brut uniquement (§1). |
| Garde d'envoi de réponse | Retour au send aveugle — **le mode d'échec #34 est ouvert** (§2). |
| Historique de pane | Vide, et le repli par cwd n'a rien où s'accrocher (§4, §5). |
| Reset de contexte du copilote | Jamais déclenché — alors que `/clear` ou `/new` existe (§9). |
| Sous-titre de notification | Étage 1 perdu (§14). |
| Nom de session | Retombe sur le label de pane (§8). |

**Ne marche pas du tout :** jauge de quota (§6 — et contrairement à Cursor, le contournement
« lancer la commande en headless » violerait l'ADR 0009, puisque `codex exec` dépense un vrai tour),
galerie d'images (§7).

**Cas particulier, et la meilleure nouvelle du dossier :** la jauge de contexte est **techniquement
faisable** pour Codex là où elle est impossible pour Cursor. Les tokens sont dans le rollout
(`token_count`, `total_token_usage`, `model_context_window` **[documenté]**), et `model_context_window`
donnerait même la taille de fenêtre réelle plutôt que le `COLLIE_BOARD_CTX_WINDOW` codé à 200 000.
Ce qui manque, c'est un lecteur pour un format entièrement différent — et d'abord le §5, sans quoi
on ne sait pas *quel* fichier lire.

**En une phrase.** Codex part avec deux longueurs d'avance sur Cursor (commandes, icône) et un
plafond plus haut (la jauge de contexte est atteignable), mais son transcript est plus loin du
format lu par collie-board, pas plus près.

---

## Ce qu'il faudrait vérifier avant de décider quoi que ce soit

Par ordre décroissant de ce que la réponse changerait :

1. **Ce que l'intégration herdr de Codex et de Cursor rapporte réellement** — un
   `--agent-session-id` ou un `--agent-session-path` ? Et publie-t-elle un token `$ctx` ? Une seule
   installation (`herdr integration install codex`) suivie d'un `herdr agent list --format json`
   répond aux deux, et déplacerait §3, §4 et §5 d'un coup. Non fait ici parce que ça écrit dans la
   configuration de l'utilisateur.
2. **La qualité de la détection d'état de herdr sur un vrai pane Cursor et Codex** — tout le socle
   « agnostique par construction » en dépend. `herdr agent explain` est fait pour ça. Si le statut
   ne passe pas correctement à `blocked`, ce n'est pas un board dégradé, c'est un board muet.
3. **Est-ce que `cursor-agent` (la CLI) écrit dans le même `~/.cursor/projects/…/agent-transcripts/`
   que l'agent de l'IDE ?** Toute la §4 côté Cursor repose là-dessus, et ça n'a pas été vérifié.
4. **Capturer deux ou trois fixtures de pane** pour chacun (dialogue d'approbation, sélecteur de
   modèle, état working) avec `scripts/capture-fixture.sh`. C'est ce qui transformerait §1 d'une
   inconnue en un chiffrage.

## Ce que le portage coûterait, si la question suit

Sans le faire, et par ordre de rapport valeur/effort :

| Lot | Effort | Ce que ça débloque |
|---|---|---|
| Accepter `agent_session.kind === "path"` (§5) | ~3 lignes | Le préalable de tout historique Codex. |
| Ajouter `cursor` à `adapters/agents.toml` (§3) | 4 lignes | Rend explicite ce qui est aujourd'hui implicite. |
| Corriger `clear` pour `codex` (§9) | 1 ligne | Le copilote se réinitialise. |
| Catalogue slash Cursor (§10) | 1 tableau | Rend le bouton commandes visible sur Cursor. |
| Icône Cursor (§11) | 1 entrée | Cosmétique. |
| Rendre la résolution de transcript enfichable (§4) | Moyen | Historique Cursor, puis Codex. |
| Lecteur d'usage Codex (§3) | Moyen | Jauge de contexte Codex, avec la vraie taille de fenêtre. |
| Adaptateur de harness Cursor ou Codex (§1, §2) | Lourd, cadré | Les boutons de dialogue **et** le garde d'envoi. C'est le vrai produit. |

Les cinq premières lignes tiennent dans un après-midi et ne demandent aucune vérification live.
Les trois dernières demandent d'abord de répondre aux questions ci-dessus.
