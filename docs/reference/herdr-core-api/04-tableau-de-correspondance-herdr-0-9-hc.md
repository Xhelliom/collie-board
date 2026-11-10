# 4. Tableau de correspondance herdr 0.9 → hc

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

## `bridge/herdr-client.ts`

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

## Événements

| herdr 0.9 | hc |
|---|---|
| `pane.agent_status_changed`, `pane.agent_detected` | `status` (`app`, `state`, `kind`, `msg`) **[mesuré]** |
| `pane.created` / `pane.closed` / `pane.exited` | `created` / `removed` / `finished {exit_code, reason}` **[mesuré : created, finished]** |
| `pane.output_matched` | `terminal.wait {output}` (par terminal, pas un événement global) **[doc]** |
| `pane.focused`, `pane.moved`, `pane.scroll_changed`, `layout.updated` | **manque** (fenêtre = herdr-app) |
| `workspace.*`, `tab.*` | **manque** |
| `session.opened/closed` | **[supposé]** `hello`/`heartbeat` + perte de connexion |
| — (nouveau) | `turn` (fin de tour, numérotée), `title`, `foreground`, `lost`/`restarted`, `labels`, `doc` |

## `launchAgent` / `promptAndConfirm` (`bridge/cards.ts`)

| étape actuelle | pourquoi elle existe (0.9) | en hc |
|---|---|---|
| `retryWhileNotReady(startAgent)` | le shell du pane source son rc | **disparaît** : `terminal.run` lance l'agent directement, pas de shell |
| `waitForAgentReady` | `agent.start` rend la main trop tôt | **disparaît** si la tâche part dans l'argv ; sinon `send` attend ~3 s de calme |
| `promptAgent` + `PROMPT_SETTLE_MS` + relecture du statut | l'ack ne dit pas si le TUI a pris | `send` renvoie `started:true|null` **[mesuré]** |
| `Enter` de rattrapage | texte collé non soumis | **reste**, mais seulement si `started:null` et `reported:true` **[mesuré]** |
| second envoi (`firstAfterLaunch`) | écran de confiance avale le prompt | **remplacé** : ne jamais taper sur un `reported:false` ; approuver le dossier ou répondre `down enter` (ou tâche dans l'argv) **[mesuré]** — un Enter aveugle fait **quitter** Claude |
| `agentInPane()` (`pane.get`) | adopter un agent déjà là | `terminal.list {labels:{collie.card:id}}` + `state:"live"` |

---
