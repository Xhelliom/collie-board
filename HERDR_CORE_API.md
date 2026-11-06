# HERDR_CORE_API.md — herdr-core (`hc`) vu depuis Collie Board

Sonde du 2026-11-05. `hc 0.1.18`, `herdr-app 0.1.13`, Claude Code `2.1.318`, sur l'hôte de déploiement
(Linux). Le contrat herdr 0.9.5 que le bridge parle aujourd'hui reste [`HERDR_API.md`](./HERDR_API.md).

Chaque fait porte une étiquette :

- **[mesuré]** — commande lancée, sortie recopiée (abrégée avec `…`, chemins de test raccourcis en `$WT`).
- **[doc]** — lu dans `hc --help`, `hc --skill`, `hc schema` ou `~/.config/herdr-app/AGENTS.md`, pas rejoué.
- **[supposé]** — déduction, ni mesurée ni écrite par herdr.

Banc d'essai : un dépôt git jetable et un worktree `$WT` (branche `wt1`) dans le scratchpad, un
`hc events` qui tournait en arrière-plan pendant toute la séance. Rien n'a été créé dans le core de
l'utilisateur en dehors de terminaux nommés `probe*`/`kid`/`envp`, tous tués et supprimés à la fin.

---

## 0. Ce qu'est herdr-core, en trois lignes

- Un **core** par utilisateur (et par machine) tient des **terminaux** (`t1`, `t2`… ou un nom). Pas
  d'espaces, pas d'onglets, pas de panneaux, pas de worktrees : ça, c'est `herdr-app` (la fenêtre), qui
  range les terminaux qui portent les labels `herdr.space=`/`herdr.tab=` **[doc]**.
- **Le statut d'un agent est annoncé par le programme lui-même** (OSC 7501) : `idle`, `working`,
  `done`, `blocked`, `error`. hc ne lit plus l'écran pour deviner **[doc]**.
- API : JSON-RPC 2.0, une ligne par message, sur `$XDG_RUNTIME_DIR/herdr-core/default.sock`. **[mesuré]**

```
$ ls $XDG_RUNTIME_DIR/herdr-core
default.holder.0d898bde.sock  default.sock
$ hc server status
{"core":{"id":"352054c9…","name":"stephane-dellpromax14…"},"live":1,"pid":72484,"version":"0.1.18",…}
```

### Protocole — différent de herdr 0.9 **[mesuré]**

**La connexion est persistante** : plusieurs requêtes sur la même socket, ids numériques acceptés.
C'est l'inverse de herdr 0.9 (une requête par connexion, `id` chaîne obligatoire).

```
$ python3 (3 requêtes sur une connexion : hello, terminal.list, terminal.get)
hello          {"id":0,"result":{"features":["framed","attach","events","status","shell",…],"generation":1,"methods":[…]}}
terminal.list  {"error":{"code":-32602,"data":{"kind":"invalid_params"},"message":"invalid type: sequence, expected a map"}}
terminal.get   {"id":2,"result":{"address":"t3","argv":["claude"],…}}
```

- `labels` en filtre est un **objet** `{"collie.card":"abc"}`, pas une liste. Avec un objet :
  `terminal.list {"labels":{"collie.card":"abc"}}` → `['t3']` **[mesuré]**.
- Erreurs : `{error:{data:{kind, hint}}}`, `kind` stable ; codes de sortie CLI 3 `not_found`,
  9 `blocked`, 10 `status_mismatch`, 11 `finished` **[doc ; 9 et 10 mesurés ci-dessous]**.
- `hc schema` = document OpenRPC complet (31 méthodes) **[mesuré]**. Liste : `hello`, `server.status|stop|restart`,
  `terminal.run|list|get|kill|rm|keep|label|read|attach|send|wait|keys|interrupt|put`, `templates.list`,
  `machine.exec|add|list|connect|rename|rm`, `file.read|write|edit`, `doc.get|set`, `events.subscribe`,
  `rpc.discover`.
- `events.subscribe` (filtrable par `terminal`, `labels`, `children_of`) envoie un instantané puis
  chaque changement, avec un `seq` monotone et des `heartbeat` **[mesuré]**. Types vus : `created`,
  `foreground`, `status`, `title`, `turn`, `size`, `finished`. **[doc]** en plus : `lost`, `restarted`,
  `keep`, `removed`, `labels`, `doc`.

---

## 1. Le statut de Claude Code dans hc

### Verdict : il remonte **sans aucun réglage**, et il est plus riche que celui de herdr 0.9

**C'est Claude Code lui-même qui émet OSC 7501** — pas un hook, pas une intégration à installer. **[mesuré]**

```
$ grep -a -o '.{150}7501.{150}' ~/.local/share/claude/versions/2.1.318
…SEMANTIC_PROMPT:133,GHOSTTY:777,ITERM2_PROPRIETARY:1337,PROGRAM_STATUS:7501,TAB_STATUS:21337…
…if(E&&_===void 0&&D)u.answer("programStatus",!1,"probe: no reply to OSC 7501 ; ?")…
```

Claude Code sonde le terminal au démarrage (`OSC 7501 ; ?`) et ne publie son statut que si le
terminal répond. hc répond ; le pane herdr 0.9 non — d'où le fait que nos panes 0.9 ne voient jamais
ce statut. Le seul hook Claude présent sur la machine (`~/.claude/hooks/herdr-agent-state.sh`,
« installed by herdr », intégration v9) parle à la **socket herdr 0.9** et sort sans rien faire hors
d'un pane herdr (`[ "${HERDR_ENV:-}" = "1" ] || exit 0`) **[mesuré, lu]**. Rien à installer pour hc.

### Ce qui remonte, tour par tour **[mesuré]** (`hc events`, terminal `probe2` = `t3`)

```
$ hc run --bg --no-parent --name probe2 --cwd $WT claude ; (écran de confiance accepté, voir §2)
t+1.5s: {"status":{"app":"claude-code","state":"idle"},"turn":0,"reported":true,"title":"Claude Code"}

$ hc send --wait probe2 "Réponds juste: OK"
{"started":true,"status":"idle","turn":0,"wait":{"reason":"status","status":"done","terminal":"t3","turn":1}}
events: status working → title "Confirmation simple OK" → status done → turn {state:done, turn:1}

$ hc send --wait probe2 "Utilise l'outil AskUserQuestion pour me demander si je préfère rouge ou bleu…"
{"status":{"app":"claude-code","kind":"question","msg":"answer: Tu préfères rouge ou bleu ? (Rouge · Bleu)","state":"blocked"},"turn":2}

$ hc run --bg --name probe3 --cwd $WT claude --permission-mode default "Lance la commande Bash: touch x.txt"
events: idle → working → {msg:"Creating empty file x.txt",state:working}
        → {"kind":"permission","msg":"approve Bash: touch x.txt","state":"blocked"} → turn {blocked,1}

pendant un `sleep 20` : {"status":{"app":"claude-code","msg":"Attendre 20 secondes","state":"working"}}
```

| statut | existe pour Claude ? | détail |
|---|---|---|
| `idle` | oui, mesuré | au démarrage, `turn: 0` |
| `working` | oui, mesuré | avec `msg` = ce qu'il fait (« Attendre 20 secondes ») |
| `done` | oui, mesuré | fin de tour ; incrémente `turn` |
| `blocked` | oui, mesuré | `kind: "question"` ou `"permission"`, `msg` = la question ou la commande à approuver |
| `error` | non observé | **[supposé]** émis sur une erreur d'API |
| `title` | oui, mesuré | le titre de session que Claude se donne |
| `turn` | oui, mesuré | compteur de tours, + un événement `turn` à chaque fin de tour |

Ce que ça remplace chez nous : la lecture d'écran pour `blocked` (et `BLOCKED_TAIL_ROWS`), la
devinette de la question en attente, une partie de `pane.agent_status_changed`. `kind` + `msg`
donnent directement le texte de la notification « bloqué : approuver Bash: touch x.txt ».

Autres agents (Codex, opencode, pi) : **[supposé]** pas de statut tant qu'ils n'émettent pas OSC 7501
eux-mêmes ; hc dit « plain programs report none. Do not guess status from screen text » **[doc]**.
Le skill hc note que Codex doit tourner avec `--no-daemon` **[doc]**. Notre `adapters/agents.toml` ne
peut donc rien affirmer pour eux sans une mesure par agent.

---

## 2. Envoyer un prompt : les courses de herdr 0.9 existent-elles encore ?

Rappel (ARCHITECTURE.md §9, `bridge/cards.ts` `launchAgent`/`promptAndConfirm`) : (a) l'agent n'est
pas prêt, (b) le prompt est tapé mais pas soumis, (c) l'écran de confiance avale le prompt.

### `hc send` attend lui-même la disponibilité **[mesuré]**

`terminal.send` : « Paste text and press Enter, once nobody has typed for ~3 s » **[doc]**. Envoi
immédiatement après `hc run --bg claude` (dossier déjà approuvé) :

```
$ hc run --bg --no-parent --name probe4 --cwd $WT claude >/dev/null; time hc send probe4 "Réponds juste: PRET"
{"started":true,"status":"idle","turn":0}
… 1,840 total
(6 s plus tard) {"status":{"app":"claude-code","state":"done"},"turn":1}   écran : "● PRET"
```

### (b) Prompt tapé mais pas soumis : **existe encore, 1 fois sur 3**, mais il se voit **[mesuré]**

Trois lancements + envoi en parallèle :

```
$ for n in 5 6 7; do ( hc run --bg … --name probe$n … claude; hc send probe$n "Réponds juste: R$n" ) & done
{"started":null,"status":null,"turn":0}      ← probe5
{"started":true,"status":"idle","turn":0}
{"started":true,"status":"idle","turn":0}
probe5 {"status":"idle","turn":0}   écran : "❯ Réponds juste: R5"   (dans la boîte, pas soumis)
probe6 {"status":"done","turn":1}
probe7 {"status":"done","turn":1}

$ hc keys probe5 enter ; sleep 6 ; hc get probe5     →  {"status":"done","turn":1}
```

Différence avec 0.9 : `send` **le dit** (`started: null`, `status: null`). Plus besoin de relire le
statut après un délai pour le deviner ; un `Enter` (`hc keys <t> enter`) répare. Le skill hc le dit
aussi : « a send to a booting agent can be dropped… Do not blindly resend: read first » **[doc]**.

### (c) Écran de confiance : **existe encore, et il est devenu destructeur** **[mesuré]**

Premier lancement dans un dossier neuf : hc ne reçoit **aucun statut** (Claude n'a pas encore sondé
OSC 7501), et le curseur du dialogue est sur **« No, exit »**.

```
$ hc run --bg --no-parent --name probe1 --label collie.card=test --cwd $WT claude
t+1..10: {"status":null,"turn":0,"reported":false,"title":"","first_message":null}
écran :  ❯ No, exit
           Yes, I trust this folder

$ hc send probe1 "dis juste OK"
{"started":null,"status":null,"turn":0}     exit=0
$ hc get probe1
{"state":"finished","exit_code":1,"reason":"exited",…}       ← Claude est parti
events: … status {"reported":true,"status":null} → finished {"exit_code":1,"reason":"exited"}
```

Le `Enter` de `send` a répondu « No, exit ». ARCHITECTURE.md §9 décrivait l'inverse sous herdr 0.7.5
(« its Enter answers "Yes, I trust this folder" ») : **c'est Claude Code qui a changé le choix par
défaut**, pas hc — **[supposé]** que nos panes herdr 0.9 subissent la même chose aujourd'hui sur un
worktree jamais approuvé ; le `Enter` de rattrapage de `promptAndConfirm` ferait alors quitter Claude.
À vérifier côté 0.9 (hors périmètre de cette sonde, qui ne touche pas `bridge/`).

Le bon geste, mesuré : `hc keys <t> down enter` sur le dialogue → statut `idle` en 1,5 s.

```
$ hc run --bg … --name probe2 … claude ; sleep 4 ; hc keys probe2 down enter
t+1: {"state":"live","status":{"app":"claude-code","state":"idle"},"turn":0,"reported":true,"title":"Claude Code"}
```

Ce qui rend le cas détectable sans lire l'écran : **`reported: false` + `status: null` plusieurs
secondes après le lancement d'un agent qui sait parler OSC 7501** **[supposé, cohérent avec la mesure]**.
Plus simple encore : approuver le dossier avant (clé `projects.<dir>.hasTrustDialogAccepted` de
`~/.claude.json`) **[supposé]** — ou passer la tâche dans l'argv (ci-dessous) : la tâche attend que le
dialogue soit répondu au lieu d'y répondre.

### Tâche passée au lancement **[mesuré]**

`hc run --bg … claude "<tâche>"` (sans template) **passe la tâche à Claude en argument** ; hc ne
l'envoie pas lui-même (`first_message: null`). Claude la traite dès qu'il est prêt :

```
$ hc run --bg --no-parent --name probe3 --cwd $WT claude --permission-mode default "Lance la commande Bash: touch x.txt"
{"argv":["claude","--permission-mode","default","Lance la commande Bash: touch x.txt"],"first_message":null,"status":null}
$ hc wait probe3 --timeout 60
{"reason":"status","status":"idle","terminal":"t4","turn":0}     ← PIÈGE : rend la main sur l'idle de démarrage
(4 s plus tard) {"status":{…,"kind":"permission","msg":"approve Bash: touch x.txt","state":"blocked"},"turn":1}
```

Piège : `hc wait` juste après un lancement-avec-argv rend la main sur l'`idle` de démarrage (turn 0).
Attendre `turn ≥ 1` (événement `turn`) plutôt que `hc wait`.

Avec un **template** (`~/.config/herdr-core/templates/<nom>.md`), c'est hc qui envoie corps + tâche
comme premier message, attend jusqu'à 60 s la disponibilité, et consigne `first_message:{sent, reason}`
**[doc ; aucun template installé ici : `hc templates` → `{"templates":[]}`]**.

### Envois pendant un tour **[mesuré]**

```
$ hc send --if idle probe2 "test if idle"
{"error":{"hint":"nothing was typed","kind":"status_mismatch","message":"t3 is working, not idle"}}   exit=10
$ hc send probe2 "Ajoute aussi le mot BONUS"          (pendant working)
{"started":true,"status":"working","turn":3}           écran : "Press up to edit queued messages"  ← mis en file par Claude
$ hc send probe2 "bleu"                                 (pendant blocked)
{"error":{"hint":"typing would answer its dialog; read its screen first (hc read t3), or --force","kind":"blocked",…}}   exit=9
$ hc interrupt probe2
{"key":"esc","outcome":"stopped"}
```

`--if idle` est exactement le garde-fou que `promptAndConfirm` ne pouvait pas avoir ; le refus sur
`blocked` évite qu'un prompt réponde à une permission.

### `hc read` **[mesuré]**

Texte brut, écran + historique (`--lines N`, `--lines 0` = écran seul). Marche sur un terminal fini
(`hc read probe2` après `kill` → 2 lignes). Pas de couleurs : **[supposé]** il faudrait `terminal.attach`
(flux brut) pour garder notre rendu ANSI.

---

## 3. Worktrees, labels, attente, parent/enfant, machines

### Worktrees — **manque dans hc** **[mesuré + doc]**

Aucune méthode `worktree.*` dans `hc schema`. herdr-app les fait dans son mod `worktree`
(`~/.config/herdr-app/mods/worktree/main.js`) en appelant **git** via `exec(...)` (= `machine.exec`),
rangés dans `~/.herdr/worktrees/<repo>/<branch>` **[lu]**. Pour nous : `worktree.create/open/remove`
→ `git worktree add/remove` dans `bridge/git.ts` (le seul endroit où l'on shell-out, déjà la règle),
puis `terminal.run {cwd}`.

### Labels **[mesuré]**

`--label k=v` au lancement, `hc label <t> k=v` après, filtre `terminal.list`/`events.subscribe`
`{labels:{k:v}}`. Libres, jamais interprétés **[doc]**. → **la carte peut vivre dans le terminal** :
`collie.card=<id>`. Plus besoin de retrouver la carte par le nom du pane. (`hc ls --json` affiche
`labels: null` alors que `hc get` les montre — bizarrerie du rendu `ls` **[mesuré]**.)

### Attendre **[mesuré]**

`hc wait <t>` (jusqu'à ≠ `working`), `send --wait` (le tour qu'on vient de lancer), `wait --output X`
(programmes simples), `wait --children all|any`. Remplace `agent.wait` et `pane.output_matched`.
Le bridge, lui, n'attend pas : il suit `events.subscribe`. Attente par défaut 180 s, `reason:timeout`
n'est pas un échec **[doc]**.

### Parent / enfant **[mesuré]**

```
$ hc run --bg --parent probe2 --name kid -- sh -c "sleep 4; echo fini"
$ hc get kid             {"parent":"t3","die_with_parent":true}
$ hc wait --children all probe2      {"children":[{"exit_code":0,"reason":"exit","terminal":"t9"}],"reason":"children"}
écran de probe2 :
❯ <hc>t9 kid exited (exit 0). Last lines:
  fini
  Read: hc read t9</hc>
● J'ai reçu une notification : le processus enfant t9 s'est terminé…      (turn 4 → 5)
```

- hc **tape une note dans l'agent parent**, ce qui lui coûte un tour (et du quota). Désactivable par
  terminal (`--no-notify`) ou globalement (`notes = false` dans `~/.config/herdr-core/config.toml`) **[doc]**.
- Un enfant **meurt avec son parent** sauf `--outlive-parent` **[doc ; `die_with_parent:true` mesuré]**.
- Le bridge n'étant pas dans un terminal hc, ses lancements n'ont pas de parent (`--no-parent` par
  prudence). Nos sous-agents de carte (`bridge/subagents.ts`) deviennent des `children_of` lisibles
  directement, sans fouiller les transcripts **[supposé]**.

### Variables d'environnement d'un terminal **[mesuré]**

```
$ hc run --no-parent --name envp -- sh -c 'env | grep -E "HC_|HERDR|TERM"'
HC_SCOPE=555961-9a84…   HC_TERMINAL_ID=t11   HC_TERMINAL_SOCKET=/run/user/1001/herdr-core/default.sock
TERM_PROGRAM=ghostty    TERM=xterm-256color  COLORTERM=truecolor
```

**Plus de `HERDR_PANE_ID`** (le programme reçoit l'environnement de la session, pas celui de
l'appelant **[doc]**). Tout ce qui relaie `HERDR_PANE_ID` en `x-collie-pane` (MCP `bridge/mcp.ts`, skill,
`since-hook.ts`, le curl du prompt de carte) doit lire `HC_TERMINAL_ID` — sinon un agent devient
`human` pour l'ADR 0010.

### `hc machine` vs nos pairs (ADR 0048/0051)

`hc machine add vps` (ssh, ou `--via '<cmd>'`), puis `hc run --on vps …` → adresse `vps/t3` ;
`exec --on`, `file read|write|edit --on` **[doc ; `hc machine ls` → `{"machines":[]}` mesuré, aucune
machine ajoutée : c'est sortant]**. Les terminaux distants passent dans le **même** `events.subscribe`
**[supposé]**.

Ce n'est pas le même objet que nos pairs : **un pair = un autre Collie qui a son board** (ADR 0048,
board partagé par git, droit `launch` par pair, ADR 0051 : l'autonomie reste locale). `hc machine`,
c'est **un shell distant sans board**. Il recouvre exactement ce qu'ADR 0046 appelait « nœud » (agents
lancés ailleurs, aucun board là-bas) — et pourrait remplacer `bridge/remote-launch.ts` pour ce cas.
Il ne remplace pas la synchro de board ni le jeton de pair. Sécurité : un `machine add` donne au core
local un shell sur l'autre machine **sans** passer par notre `checkAccess` — à ne jamais exposer depuis
le téléphone sans un droit explicite.

### Persistance et reprise **[doc]**

`--keep` : programme perdu (crash du core, reboot) → **un shell** au même endroit, **la commande n'est
jamais relancée**. Exit ou kill : fini pour de bon. `server restart` garde les programmes. → un agent
de carte survit à un redémarrage du core, pas à un reboot (là, notre handoff reste nécessaire).

### Stockage `doc.get/set` **[mesuré : param `name` requis]**

Document JSON opaque versionné (≤ 1 MiB), évènement `doc` à chaque écriture. **[supposé]** inutile pour
nous (le board a sa base) ; à ne pas utiliser pour l'état durable (règle « card durable »).

---

## 4. Tableau de correspondance herdr 0.9 → hc

### `bridge/herdr-client.ts`

| herdr 0.9 (`HerdrClient`) | méthode herdr | équivalent hc | note |
|---|---|---|---|
| connexion one-shot, `id` chaîne | — | connexion persistante, `id` libre **[mesuré]** | `dialHerdr` à réécrire |
| `ping()` | — | `hello` / `server.status` **[mesuré]** | |
| `listWorkspaces()` | `workspace.list` | **manque** dans hc ; `herdr-app ls` (fenêtre ouverte) | regrouper par label/`cwd` |
| `listTabs()` | `tab.list` | **manque** ; idem | |
| `listPanes()` | `pane.list` | `terminal.list` **[mesuré]** | |
| `sessionSnapshot()` | `session.snapshot` | `terminal.list` + 1er message d'`events.subscribe` **[mesuré]** | |
| `subscribeEvents()` | `events.subscribe` | `events.subscribe {labels?}` **[mesuré]** | flux unique, `seq`, heartbeats |
| `createWorkspace({cwd,label})` | `workspace.create` | **manque** ; `herdr-app do space.new` si on veut l'afficher **[doc]** | sinon rien : un terminal suffit |
| `createTab(ws,{cwd,label})` | `tab.create` | `terminal.run {cwd, labels}` ; `herdr-app do tab.new` pour l'onglet **[doc]** | |
| `readPane(id, …)` | `pane.read` | `terminal.read {lines}` **[mesuré]** | texte sans ANSI ; ANSI = `terminal.attach` |
| `sendPaneText(id, text)` | `pane.send_text` | `terminal.send` (colle + Enter) **[mesuré]** | pas de « coller sans Enter » ; **[supposé]** `terminal.keys` pour des caractères |
| `sendPaneKeys(id, keys)` | `pane.send_keys` | `terminal.keys` **[mesuré : `down enter`, `esc`, `enter`]** | grammaire différente : `ctrl+c`, `esc`, `up` (minuscules) |
| `closePane(id)` | `pane.close` | `terminal.kill` puis `terminal.rm` **[mesuré]** | |
| `renamePane(id,label)` | `pane.rename` | `terminal.label` (`name` fixé au `run`) **[mesuré]** | |
| `renameTab` / `closeTab` | `tab.rename/close` | **manque** (herdr-app) | |
| `createWorktree()` | `worktree.create` | **manque** → `git worktree add` (`bridge/git.ts`) + `terminal.run {cwd}` | comme le mod worktree d'herdr-app |
| `openWorktree()` | `worktree.open` | **manque** → `terminal.list {labels:{collie.card}}` puis `run` si absent | l'idempotence vient du label |
| `removeWorktree()` | `worktree.remove` | **manque** → `git worktree remove` | |
| `startAgent({paneId,kind,name,args})` | `agent.start` | `terminal.run {argv:[agent,…args, tâche], cwd, labels, name, no_parent, keep}` **[mesuré]** | plus de shell intermédiaire |
| `getAgent(target)` | `agent.get` | `terminal.get` → `status.state`, `kind`, `msg`, `turn` **[mesuré]** | |
| `promptAgent({target,text})` | `agent.prompt` | `terminal.send {if:"idle"}` → `started` **[mesuré]** | |
| `waitAgent({until})` | `agent.wait` | `terminal.wait` / `send {wait}` **[mesuré]** | bridge : événements plutôt |
| `getPane(id)` | `pane.get` | `terminal.get` **[mesuré]** | |
| `reportPaneMetadata()` | `pane.report_metadata` | `terminal.label` **[supposé]** | herdr-app n'affiche pas nos labels |
| `paneProcess(id)` | `pane.process_info` | `terminal.get` → `foreground {pid, cwd, argv}` **[mesuré]** | |
| `agent.notify` | `agent.notify` | **manque** (les notes `<hc>` vont dans un parent, pas dans l'UI) | la cloche/push restent à nous |

### Événements

| herdr 0.9 | hc |
|---|---|
| `pane.agent_status_changed`, `pane.agent_detected` | `status` (`app`, `state`, `kind`, `msg`) **[mesuré]** |
| `pane.created` / `pane.closed` / `pane.exited` | `created` / `removed` / `finished {exit_code, reason}` **[mesuré : created, finished]** |
| `pane.output_matched` | `terminal.wait {output}` (par terminal, pas un événement global) **[doc]** |
| `pane.focused`, `pane.moved`, `pane.scroll_changed`, `layout.updated` | **manque** (fenêtre = herdr-app) |
| `workspace.*`, `tab.*` | **manque** |
| `session.opened/closed` | **[supposé]** `hello`/`heartbeat` + perte de connexion |
| — (nouveau) | `turn` (fin de tour, numérotée), `title`, `foreground`, `lost`/`restarted`, `labels`, `doc` |

### `launchAgent` / `promptAndConfirm` (`bridge/cards.ts`)

| étape actuelle | pourquoi elle existe (0.9) | en hc |
|---|---|---|
| `retryWhileNotReady(startAgent)` | le shell du pane source son rc | **disparaît** : `terminal.run` lance l'agent directement, pas de shell |
| `waitForAgentReady` | `agent.start` rend la main trop tôt | **disparaît** si la tâche part dans l'argv ; sinon `send` attend ~3 s de calme |
| `promptAgent` + `PROMPT_SETTLE_MS` + relecture du statut | l'ack ne dit pas si le TUI a pris | `send` renvoie `started:true|null` **[mesuré]** |
| `Enter` de rattrapage | texte collé non soumis | **reste**, mais seulement si `started:null` et `reported:true` **[mesuré]** |
| second envoi (`firstAfterLaunch`) | écran de confiance avale le prompt | **remplacé** : ne jamais taper sur un `reported:false` ; approuver le dossier ou répondre `down enter` (ou tâche dans l'argv) **[mesuré]** — un Enter aveugle fait **quitter** Claude |
| `agentInPane()` (`pane.get`) | adopter un agent déjà là | `terminal.list {labels:{collie.card:id}}` + `state:"live"` |

---

## 5. Sans plugin herdr : installer, démarrer, mettre à jour le bridge

herdr-core et herdr-app n'ont **ni plugins, ni actions** **[doc : `hc --help`, `herdr-app --help` ;
herdr-app a des *mods* JS (UI dans la fenêtre), pas de registre d'actions invocables en CLI]**.
Aujourd'hui `herdr-plugin.toml` porte 9 actions : `setup`, `start`, `stop`, `restart`, `uninstall`,
`update`, `url`, `status`, `version` ; `ctl.ts` sait déjà faire le service systemd (Linux), et la
tâche planifiée (`schtasks`, Windows).

### Proposition

1. **Le service reste le service de l'OS, piloté par `scripts/ctl.ts`.** Pas `hc run --keep` :
   `--keep` ne relance jamais la commande (après un reboot on aurait un shell vide à la place du
   bridge) et un bridge dans un terminal hc vit à la merci d'un `hc server stop` **[doc]**. systemd
   `--user` (Linux), `launchd` LaunchAgent (macOS, à ajouter), `schtasks` (Windows, existe).
   Le service ne dépend plus de `HERDR_SOCKET_PATH`/`HERDR_PLUGIN_CONFIG_DIR` : socket =
   `$XDG_RUNTIME_DIR/herdr-core/default.sock` (Linux) **[mesuré]**, config fixe `~/.config/collie-board`
   (c'est déjà la valeur posée par `systemd/collie-board.service`).
   **[supposé]** `After=` sur le core : inutile, le bridge sait déjà afficher `disconnected` et se
   reconnecter ; le core se démarre à la demande (le skill hc précise que *sur Windows* `hc server
status` n'en démarre jamais, donc ailleurs oui **[supposé, d'après la doc]**).

2. **Un point d'entrée qui marche depuis n'importe où : `collie-board <action>`.** `ctl.ts install`
   pose un lanceur `~/.local/bin/collie-board` → `bun <checkout>/scripts/ctl.ts "$@"`. Les 9 actions du
   plugin deviennent `collie-board setup|start|stop|restart|uninstall|update|url|status|version`, mêmes
   noms. C'est ce que la règle « Update notice » de CLAUDE.md protégeait (indépendant du cwd et du nom
   d'unité) : elle se réécrit en `collie-board update` / `collie-board restart` — **ADR à écrire** au
   moment de la bascule, puisqu'elle remplace une règle normative.

3. **`update`** = ce que fait déjà `collie-board-ctl.sh update` moins le re-link herdr : `git pull`
   sur le tag de release → `build` (typecheck + dist atomique) → `restart`. Le bandeau de mise à jour
   affiche `collie-board update`. Installation initiale : `git clone` + `bun scripts/ctl.ts install`
   (fait `setup` + service + lanceur), à la place de `herdr plugin install`.

4. **Optionnel : un mod herdr-app « Collie »** (`~/.config/herdr-app/mods/collie/`) — un menu ou un
   panneau qui appelle `exec("collie-board", ["restart"])` etc. et ouvre l'URL du board. C'est
   l'équivalent visuel des actions de plugin dans la fenêtre. Optionnel, parce qu'il ne sert que
   quand la fenêtre est ouverte, alors que le téléphone est le premier client. **[supposé]** faisable :
   les mods ont `exec` (le mod worktree s'en sert) **[lu]**.

5. **Les actions `herdr.collie-board`** : gardées tant que herdr 0.9 coexiste (le manifeste ne coûte
   rien), puis supprimées avec `herdr-plugin.toml` quand le bridge ne parle plus que hc. La version
   canonique passe alors de `herdr-plugin.toml` à `package.json` (`check-version.sh` et ADR 0016 à
   ajuster dans le même mouvement).

---

## 6. Conclusion (une page)

### Ce qui se simplifie

- **Le statut de Claude est fourni, juste, et sans réglage.** OSC 7501 natif dans Claude Code
  2.1.318 : `idle/working/done/blocked`, plus `kind` (`question`/`permission`), `msg` (la question,
  la commande à approuver, l'activité en cours), `title`, et un compteur `turn`. Toute la détection par
  écran (`blocked` deviné, extrait de question, fin de tour) peut tomber.
- **Plus de shell intermédiaire.** `terminal.run` lance l'agent avec sa tâche en argument : les deux
  courses de `launchAgent` (rc du shell, agent pas encore cible) disparaissent.
- **`send` dit s'il a pris** (`started`), refuse un agent `blocked`, sait `--if idle`. `promptAndConfirm`
  passe de « taper, attendre, relire, re-taper » à « envoyer, lire `started` ».
- **Les labels portent la carte** (`collie.card=<id>`), filtrables à la source : adoption/idempotence
  sans `worktree.open`.
- **Une connexion persistante** au lieu d'une connexion par requête ; un seul flux d'événements, numéroté.
- **Parent/enfant natif** : les sous-agents d'une carte deviennent visibles (`children_of`).

### Ce qui manque dans hc

- **Worktrees** (à faire nous-mêmes en git — `bridge/git.ts` le fait déjà en partie).
- **Espaces / onglets / focus / layout** : n'existent que dans herdr-app, pilotable par `herdr-app do`
  mais seulement fenêtre ouverte **[doc]**. Tout ce que le board range « par workspace » doit être
  rangé par label ou par dépôt.
- **Notifications** (`agent.notify`) : rien côté hc ; nos push/cloche restent seuls.
- **Lecture colorée** : `terminal.read` est du texte nu ; garder l'ANSI demande `terminal.attach`.
- **Plugins et actions** : remplacés par `ctl.ts` + lanceur (§5).
- **`HERDR_PANE_ID`** : devient `HC_TERMINAL_ID` ; la provenance `agent` (ADR 0010) en dépend.
- **Statut des autres agents** (Codex, opencode, pi) : à mesurer un par un ; rien sans OSC 7501.

### Ce qui bloque une V2

1. **L'écran de confiance fait quitter Claude** sur un `Enter` aveugle (choix par défaut « No, exit »
   en 2.1.318, mesuré). Un worktree par carte = un dossier neuf par carte. Il faut décider *avant* la
   V2 : pré-approuver le dossier, ou tâche dans l'argv + `down enter` explicite quand `reported` reste
   `false`. **Probablement déjà vrai pour le bridge 0.9 actuel** — à vérifier en priorité, hors V2.
2. **Le modèle « workspace/onglet » du board** (snapshot, UI, regroupements) n'a pas d'équivalent hc :
   c'est la plus grosse réécriture (`state-engine`, `herdr-client`, une bonne part du web).
3. **Les autres harnais** : sans OSC 7501 chez eux, la V2 serait Claude-seulement — à moins de garder
   l'adaptateur écran comme repli pour eux.
4. **Coexistence** : rien n'oblige à basculer d'un coup — **[supposé]** un second client `hc` derrière
   la même interface que `HerdrClient`, choisi par config, permettrait de faire tourner les deux pendant
   la migration. C'est la voie que la règle « garder la surface amont étroite » impose de toute façon.

---

## 7. Windows (Collie Windows, ADR 0050)

**État au 2026-11-06 : mesuré sur le poste** (`Dell-5550-Stef`, Windows 11 Pro 10.0.26200, depuis une
carte Collie Board qui tourne dessus). La première rédaction (2026-11-05, #250) venait de l'hôte Linux
sans accès shell : ce qui suit sépare ce qui était **lu**, ce qui a été **mesuré** depuis, et la sonde
telle qu'elle a tourné.

**Verdict.** Sous Windows, hc se comporte comme sous Linux pour tout ce qui compte au bridge : Claude
Code publie son statut OSC 7501 à travers ConPTY (`idle`/`working`/`done`/`blocked` avec `kind`+`msg`),
`hc send` dit s'il a été pris, l'écran de confiance tue Claude sur un `Enter` aveugle, et **Bun parle
JSON-RPC au named pipe avec `node:net`, sur une connexion persistante**. Aucun obstacle Windows propre
n'a été trouvé pour une V2 du bridge sur hc.

### Ce qui est lu **[doc]**

- Installeur `irm https://releases.herdr.dev/app/install.ps1 | iex` (lu, 103 lignes) : app dans
  `%LOCALAPPDATA%\Programs\herdr-app` (ajoutée au PATH utilisateur, raccourci menu Démarrer), puis
  `releases.herdr.dev/core/install.ps1` **seulement si** `%LOCALAPPDATA%\Programs\herdr-core\herdr-core.exe`
  et `herdr-core` dans le PATH sont absents. Prérequis : `curl.exe` et `tar.exe` de `System32`
  (Windows 10 1803+). Un core déjà installé n'est pas mis à jour par cet installeur.
- `hc --skill` (0.1.18) : sous Windows **`hc server status` ne démarre jamais de core** ; il faut ouvrir
  Herdr ou lancer `hc server start` dans un terminal de bureau normal. Un démarrage par SSH élevé peut
  bloquer la session de bureau du même utilisateur. Un nouveau terminal relit PATH et l'environnement.
- Config : `%APPDATA%\herdr-core\config.toml` (`shell = ["…"]` remplace PowerShell, le shell par défaut).
- Transport : named pipe à la place de `$XDG_RUNTIME_DIR/herdr-core/default.sock` (donnée du ticket) ;
  **le nom du pipe n'est écrit nulle part** dans `hc --skill` ni dans l'installeur.
- Templates de `hc` : demandent `sh` dans le PATH (Git for Windows). Ticket connu : `hc machine add`
  plante depuis Windows (OpenSSH).

### Ce qui a été mesuré (2026-11-06)

| Point | Question | Résultat |
|---|---|---|
| Installation | versions `hc`/`herdr-app`, core démarré par l'app ou à la main | **[mesuré]** Rien d'installé avant. L'installeur (relu avant exécution, identique à la lecture ci-dessus) pose **herdr-app 0.1.13** puis **hc 0.1.18** (`hc.exe` et `herdr-core.exe`, même binaire de 8 828 192 o, plus `conpty\x64\conpty.dll`) et ajoute `herdr-core` au PATH utilisateur. Avant tout démarrage, `hc server status` sort en code 5 : `{"error":{"kind":"unavailable","message":"the Windows core is not reachable: Le fichier spécifié est introuvable. (os error 2)"}}`, comme le dit le skill. **Core démarré à la main** : `hc server start` rend la main tout de suite, le core reste détaché (`pid` distinct, `core.name` = `dell-5550-stef`). L'app n'a pas été ouverte. Autres versions : Claude Code 2.1.319, Bun 1.4.3. |
| Nom du pipe | `\\.\pipe\…` effectif | **[mesuré]** `\\.\pipe\herdr-core-steph-default.sock`, soit `herdr-core-<utilisateur>-<instance>.sock`. Il disparaît après `hc server stop`. |
| Statut Claude | OSC 7501 remonte-t-il (`reported:true`, `idle`→`working`→`done`) sous ConPTY ? | **[mesuré] oui, même suite d'états que sous Linux (§1).** Sur l'écran de confiance : `reported:false`, `status:null` pendant 12 s. 0,6 s après `hc keys probe1 down enter` : `{"app":"claude-code","state":"idle"}`, `reported:true`, `title:"Claude Code"`. `hc events --json` : `status idle` → `title "Claude Code"` → `status working` → `title "Confirmation simple OK"` → `status done` → `turn {state:done, turn:1}`. `blocked` aussi : `claude --permission-mode default "Lance la commande Bash: touch x.txt"` donne `working` (t+2 s) puis `{"kind":"permission","msg":"approve Bash: touch x.txt","state":"blocked"}`, `turn:1` (t+4 s). `identity` du terminal : `"ghostty"`. |
| `hc send` | attend-il la disponibilité comme sous Linux ? prompt soumis ? | **[mesuré]** Sur un Claude `idle`, `hc send probe1 "dis juste OK"` renvoie `{"started":true,"status":"idle","turn":0}`, et `hc wait probe1` rend `{"ended":true,"reason":"status","status":"done","turn":1}` en 1,7 s. À l'écran : `❯ dis juste OK` / `● OK`. Le prompt est donc soumis. Sur un Claude qui n'a pas encore publié de statut (écran de confiance), on obtient `{"started":null,"status":null,"turn":0}` et le code de sortie 0, comme sous Linux. |
| Écran de confiance | curseur sur « No, exit » comme sous Linux (§2c) ? | **[mesuré] oui, et `send` le rend destructeur, comme sous Linux.** Dans un dossier neuf (`git init`), le dialogue affiche `❯ No, exit` / `Yes, I trust this folder`. `hc send probe3 "dis juste OK"` dessus, puis 4 s d'attente : `{"state":"finished","exit_code":1,"reason":"exited","reported":true,"status":null}`, Claude est parti. Le bon geste reste `hc keys <t> down enter`. |
| Bun → pipe | `node:net` `connect({path})` sur le pipe, `hello` répond ? connexion persistante ? | **[mesuré] oui pour les deux.** `connect({ path: "\\\\.\\pipe\\herdr-core-steph-default.sock" })` se connecte en 6 ms. JSON-RPC en lignes (`…\n`) : `hello` répond `{"id":1,"jsonrpc":"2.0","result":{"core":{…},"features":["framed","attach","events","status","shell","resize_notifications","automatic_input"],"framed":false,"generation":1,"methods":[…32 méthodes…],"version":"0.1.18"}}`. Un **second** appel sur la même connexion (`hello`, puis `terminal.list` dans un autre essai) reçoit sa réponse : **la connexion n'est pas one-shot**, contrairement à la socket herdr 0.9. Un mauvais nom de pipe donne `ERR ENOENT connect ENOENT \\.\pipe\herdr-core-nope.sock`. |

Constaté en passant **[mesuré]** : le core **hérite de l'environnement de qui le démarre**. Démarré
depuis une session Claude Code (cette carte), il a transmis `CLAUDE_CODE_CHILD_SESSION` aux Claude
qu'il a lancés. Leur écran affichait « Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
marker », ils étaient en auto mode et proposaient un sondage de feedback. Le bridge ne devra donc
jamais démarrer le core depuis un agent : c'est à l'app ou au bureau de le faire, comme le dit déjà le
skill. Le core de la sonde a été arrêté (`hc server stop` → `{"stopped":true}`).

Méthodes annoncées par `hello` sous Windows : `hello`, `server.status/stop/restart`, `terminal.run/list/get/kill/rm/keep/label/read/attach/send/wait/keys/interrupt/put`,
`templates.list`, `machine.exec/add/list/connect/rename/rm`, `file.read/write/edit`, `doc.get/set`,
`events.subscribe`, `rpc.discover`.

Non mesuré ici : le démarrage du core par herdr-app (l'app n'a pas été ouverte), `hc machine add`
depuis Windows, et les autres harnais (Codex, opencode, pi).

### Sonde lancée sur le poste Windows

Elle a tourné telle quelle, à trois écarts près :
- `hc server start` a été lancé par `Start-Process` caché, depuis la session de la carte, pas depuis un
  terminal de bureau. C'est la cause de l'héritage d'environnement signalé plus haut.
- `hc events --json` a tourné dans un `Start-Process` plutôt qu'un `Start-Job`.
- `probe2` (statut `blocked`) et `probe3` (`send` sur l'écran de confiance) ont été ajoutés.

PowerShell, dans un terminal de bureau (pas SSH), avec Git for Windows, Bun et Claude Code installés :

```powershell
hc --version; herdr-app --version; claude --version
hc server start; hc server status
[IO.Directory]::GetFiles('\\.\pipe\') | Select-String herdr     # nom du pipe

$wt = Join-Path $env:TEMP "hc-probe-$(Get-Random)"; git init -q $wt     # dossier neuf → écran de confiance
Start-Job { hc events --json > "$env:TEMP\hc-events.jsonl" } | Out-Null
hc run --bg --no-parent --name probe1 --label collie.card=test --cwd $wt claude
1..10 | % { Start-Sleep 1; hc get probe1 }    # status / reported / turn
hc read probe1                                 # où est le curseur du dialogue de confiance ?
# Si le dialogue est là : hc keys probe1 down enter  (ne PAS envoyer un Enter aveugle)
hc send probe1 "dis juste OK"; hc wait probe1; hc get probe1
Get-Content "$env:TEMP\hc-events.jsonl" | Select-String probe1    # suite des statuts
hc kill probe1; hc rm probe1
```

Bun, une requête JSON-RPC sur le pipe (`bun probe-pipe.ts '\\.\pipe\<nom>'`) :

```ts
import { connect } from "node:net";
const s = connect({ path: process.argv[2] }, () =>
  s.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hello", params: {} }) + "\n"));
s.on("data", (b) => { console.log(b.toString()); s.end(); });
s.on("error", (e) => { console.error("ERR", e.message); process.exit(1); });
```

Le résultat attendu, si le pipe parle le même protocole que la socket Linux (§0) : une ligne
`{"id":1,"result":{"features":[…],"methods":[…]}}`. Une erreur `ENOENT` = mauvais nom ; un silence =
framing différent (le core annonce `framed` dans ses `features`).

**[mesuré] 2026-11-06** : c'est bien ce qui revient (`"framed":false`, lignes terminées par `\n`), et
`ENOENT` pour un nom faux. La version de la sonde qui a tourné envoie un second appel sur la même
connexion pour tester la persistance (tableau ci-dessus).
