# Reconnaissance — un nœud Collie natif sous Windows

Reconnaissance préalable à l'ADR « nœud Windows » : peut-on faire tourner herdr + le bridge
**nativement** (pas WSL) sur un poste Windows, pour qu'un agent y pilote des applis Windows —
SolidWorks via COM en tête ? Aucun code produit n'a été modifié ; tout ce qui suit a été exécuté à la
main sur le poste, le 2026-10-22.

**Verdict : faisable avec adaptations.** Le cœur — herdr natif, le socket, le bridge sous Bun, le
snapshot, le lancement d'un agent, les worktrees, `tailscale serve`, le COM depuis un pane — marche
déjà. Ce qui manque est de l'outillage autour (supervision, plugin herdr, scripts Bash) et une
poignée de bugs de chemins. Détail et effort en [§ 6](#6-recommandation).

## Poste et versions

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200, session console (ID 2), compte **non élevé**, pas de Developer Mode, pas de WSL |
| herdr | **0.9.5** (canal stable, protocole 22), `x86_64-pc-windows-msvc` |
| Bun | 1.4.3 (winget `Oven-sh.Bun`) |
| Git | Git for Windows 2.55.0 (`core.autocrlf=true` au niveau système, défaut de l'installeur) |
| Tailscale | 1.104.2 |
| Claude Code | 2.1.308 (installeur natif, `~/.local/bin/claude.exe`) |
| Collie | `main` @ `214599e` (0.231.1) |
| SolidWorks | **non installé** (`SldWorks.Application` absent du registre) — voir [§ 4](#4-com--solidworks) |

---

## 1. herdr natif

### Installation et session — ✅

```powershell
irm https://herdr.dev/install.ps1 | iex      # canal stable par défaut
# ==> Installing Herdr 0.9.5 for x86_64-pc-windows-msvc … Herdr 0.9.5 installed successfully.
```

L'installeur vérifie le SHA-256 du manifeste, installe sous `%LOCALAPPDATA%\Programs\Herdr\bin` et
ajoute un dossier au PATH utilisateur. Lancé dans Windows Terminal (`wt new-tab herdr`), le serveur
tourne dans la session interactive de l'utilisateur (ID 2, la même que le bureau). Le shell par
défaut d'un pane est **Windows PowerShell 5.1**.

Au premier lancement, herdr **installe de lui-même son intégration Claude** :
`~/.claude/hooks/herdr-agent-state.ps1` (`herdr integration status` → `claude: current (v11)`).
C'est elle qui fournit `agent_session` ; le bridge a bien obtenu l'`agentSessionId` du pane Claude.

### Où écoute l'API — named pipe ✅

Ni AF_UNIX ni TCP : un **named pipe** dont le nom est le chemin complet du « socket ».

```
herdr status → socket: %APPDATA%\herdr\herdr.sock
herdr-server.log → api server listening path=%APPDATA%\herdr\herdr.sock
%APPDATA%\herdr\herdr.sock          fichier ordinaire de 24 octets : "6936:1792672314542641400" (pid:horodatage)
\\.\pipe\C:\Users\<user>\AppData\Roaming\herdr\herdr.sock          ← le vrai transport
```

C'est exactement ce que `bridge/dial.ts` suppose (`toPipeName`, `node:net` sur win32) et ce que
`defaultSocketPath()` calcule (`%APPDATA%\herdr\herdr.sock`) : **vérifié en live, sans réglage**.
Les sessions nommées suivent le même schéma : `%APPDATA%\herdr\sessions\<nom>\herdr.sock`
(`herdr session list`), et `discoverSessionSockets` les trouve (vérifié avec une session `recon` :
le snapshot du bridge l'a listée `reachable: true`).

Les logs : `%APPDATA%\herdr\herdr.log`, `herdr-server.log`, `herdr-client.log`.

### Les appels de `HERDR_API.md` utilisés par le bridge

Rejoués **à travers le `dialHerdr` du bridge** (Bun 1.4.3, `node:net` → named pipe), contre le
serveur 0.9.5 :

| Appel | Résultat | Sortie (extrait exact) |
|---|---|---|
| `session.list` | ❌ **n'existe pas** dans l'API socket (ni en 0.9.5 ni dans `HERDR_API.md`) — c'est `herdr session list` côté CLI. Le bridge ne l'appelle pas. | ``{"id":"1","error":{"code":"invalid_request","message":"invalid request: unknown variant `session.list`, expected one of `ping`, … `session.snapshot`, …"}}`` |
| `session.snapshot` | ✅ | `{"result":{"type":"session_snapshot","snapshot":{"version":"0.9.5","protocol":22,"focused_workspace_id":"w1",…,"panes":[{"pane_id":"w1:p1",…,"cwd":"C:\\Users\\<user>\\src\\collie-board",…` |
| `workspace.list` | ✅ | `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"w1","number":1,"label":"collie-board",…}]}}` |
| `pane.list` | ✅ | `{"result":{"type":"pane_list","panes":[{"pane_id":"w1:p1",…,"agent_status":"unknown","scroll":{…},"revision":0}]}}` |
| `pane.read` (`visible`/`text`, `recent`/`ansi`) | ✅ | `{"result":{"type":"pane_read","read":{"pane_id":"w1:p1",…,"text":"PS C:\\Users\\<user>\\src\\collie-board>\n","revision":0,"truncated":false}}}` |
| `pane.send_text` + `pane.send_keys ["Enter"]` | ✅ — la commande s'exécute dans PowerShell | relu ensuite : `PS …> Write-Output ('probe-' + 6*7)\nprobe-42\nPS …>` |
| `pane.send_keys` — clés refusées | ✅ conforme | `PageUp` / `Delete` / `BTab` → `{"error":{"code":"invalid_key","message":"unsupported key PageUp"}}` |
| `pane.send_keys ["C-c"]` | ⚠️ **diverge de `HERDR_API.md`** : accepté, et tapé comme `^C` | `{"result":{"type":"ok"}}` — le doc dit `invalid_key` (vérifié en 0.7.0). Sans effet sur le bridge, qui envoie `ctrl+c`. |
| `events.subscribe` (la liste de `buildSubscriptions`, 15–16 abonnements) | ✅ | `{"id":"s","result":{"type":"subscription_started"}}` puis `{"event":"tab_created",…}`, `pane_created`, `{"event":"tab_closed",…}` sur un `tab.create`/`tab.close` |
| `tab.create` | ✅ | `{"result":{"type":"tab_created","tab":{"tab_id":"w1:t3",…},"root_pane":{"pane_id":"w1:p3",…}}}` |
| `agent.start` (`kind:"claude"`) | ✅ | `{"result":{"type":"agent_started","agent":{…,"launch_pending":true,…},"argv":["claude"]}}` — herdr tape `& claude` dans le pane PowerShell |
| `agent.get` | ✅ | puis `"agent_status":"idle","interactive_ready":true` une fois l'invite passée |
| `worktree.create` / `worktree.remove` | ✅ **après correction du PATH** (voir piège ci-dessous) | `checkoutPath: "C:\\Users\\<user>\\.herdr\\worktrees\\collie-board\\probe-windows-recon"` |

Claude Code lancé par `agent.start` s'arrête d'abord sur l'invite **« Quick safety check: Is this a
project you created or one you trust? »** (`agent_status: "blocked"`, `launch_pending: true`) —
une fois par dossier, comme sous Linux ; `Down`,`Enter` l'a passée et l'agent est devenu
`interactive_ready` en 1,5 s.

**Piège : le serveur herdr hérite du PATH de celui qui le lance.** Premier essai :

```
herdr worktree.create: worktree_create_failed: program not found
```

Le serveur avait été lancé depuis un shell dont le PATH était antérieur à l'ajout de Git ; il ne
trouvait pas `git`. Les **panes**, eux, voyaient Git (leur environnement est reconstruit depuis le
registre). Relancé avec un PATH rafraîchi (Machine + User), `worktree.create` passe. À retenir pour
la supervision : démarrer le serveur herdr dans un environnement de logon frais (tâche planifiée à
l'ouverture de session), jamais depuis un shell de longue durée.

**Effort : nul** pour herdr lui-même. Une ligne de doc pour le piège du PATH, une correction de
`HERDR_API.md` pour `C-c`.

---

## 2. Le bridge sous Bun Windows

### Tests

`bun test ./bridge ./scripts` (la moitié Bun de `bun run test`, sans `collie-board-ctl.test.sh`) :

```
 1403 pass
 54 fail
 3523 expect() calls
Ran 1457 tests across 74 files. [69.09s]
```

`cd web && bun run test` : **169 fichiers, 1823 tests, tous verts** (Vitest 4.1.9, 108 s).

`bun run build` (typecheck racine + web, puis build) : ✅ — après un contournement, voir
[`bunx`](#ce-qui-casse-à-linstallation).

Les 54 échecs, classés :

| Cause | Nb | Tests | Nature |
|---|---|---|---|
| Littéraux POSIX dans les fakes, comparés à `path.join`/`resolve` qui rendent `\` | 24 | `sessions` (8), `uploads.sweepUploads` (3), `transcript` image/gallery (3), `server.resolveStaticPath` (2), `mcp-setup` (2), `usage.claudeCandidates` (2), `config.loadConfig`, `board.isSafeDiffPath`, `board.scanRootsFor`, `deps.installDirs` | **surtout des tests** — `Expected: "/home/me/.claude/projects"` / `Received: "C:\\Users\\…\\.claude\\projects"`. Le code tourne en live (le bridge sert `web/dist`, découvre les sessions). Deux révèlent un vrai bug, voir plus bas. |
| `symlink` → `EPERM: operation not permitted` | 8 | `artifacts`, `backup`, `deliverables`, `gallery`, `templates`, `transcript` (2), `install-skill` | créer un lien symbolique exige Developer Mode ou l'élévation. Tests de sécurité (évasion par symlink) : à sauter sur win32 sans privilège, pas à supprimer. |
| Exécutables POSIX absents du PATH | 10 | `Executable not found in $PATH: "bash"` (5 : `check-untracked`, `install-skill`), `"mkdir"`, `"chmod"`, `"true"` (2, `gate`), `"gh"` (1) | les tests appellent des binaires Unix ; `gh` manquait seulement dans l'environnement du shell de test |
| Plateforme | 8 | `processStartedAt` (`/proc` ou `ps`, absents → `null`) et les 5 `resolveForProcess` qui en dépendent ; permissions `0600` (2 : `Expected: 384` / `Received: 438`) | vrai écart de fonctionnalité, dégradé proprement (voir plus bas) |
| Divers | 4 | `backup-coverage` : `EBUSY: resource busy or locked, rm '…\collie-coverage-…'` (fichier SQLite encore ouvert au nettoyage, verrouillage Windows) ; `lot.test` : SHA attendu ≠ obtenu (checkout en CRLF via `core.autocrlf=true`) ; `autonomy.test:104` et `project.test:610` : réponse `null` d'une route, cause non isolée | à investiguer |

### Le bridge en live — ✅ `/api/snapshot` liste les panes

```powershell
bun bridge/index.ts            # local seulement, 127.0.0.1:8788, aucune variable réglée
```

```
[bridge] listening on http://127.0.0.1:8788  (poll 1500ms)
[events] stream up (15 subscriptions)
[events] resubscribed (16 subscriptions)
```

`GET /api/snapshot` → `200` : `"bridge":"connected"`, l'agent Claude (`w1:p3`, `status:"idle"`,
`agentSessionId` renseigné) dans `agents`, le shell PowerShell (`w1:p1`) dans `shellPanes`, la
session `default` `reachable: true`. Vérifié aussi en live :

| Route / brique | Résultat |
|---|---|
| `GET /` (sert `web/dist`) | ✅ 200 |
| `GET /api/pane/w1:p3` | ✅ texte du pane Claude |
| `GET /api/board/usage` | ✅ jauges lues via `claude.exe` (trouvé par `Bun.which`) |
| `POST /api/cards`, `GET /api/cards`, `DELETE /api/cards/:id` | ✅ — base SQLite dans le `stateDir` |
| `GET /api/board/prs`, `GET /api/orchestrator/since` | ✅ (`{"prs":[]}`, `204`) |
| `git.ts` sur un vrai worktree herdr : `diffStat`, `diffFile` (suivi et non suivi), `ensureBoardExcluded`, `currentBranch`, `worktreePathFor` | ✅ |
| Redémarrage du serveur herdr sous le bridge | ✅ `[state] poll failed, marking disconnected: connect ENOENT \\.\pipe\…\herdr.sock` puis `[events] stream up` — reprise seule |

### Où il casse

| Point | Constat | Effort |
|---|---|---|
| **Socket** | ✅ rien à faire — named pipe déjà géré par `dial.ts`. | — |
| **Chemins : `/` de git contre `\` de Node/herdr** | ❌ **vrai bug.** Git for Windows rend `C:/Users/…` (`rev-parse --show-toplevel`, `worktree list`), herdr et Node `C:\Users\…`. Observé : `GET /api/repos` liste **deux fois** le même dépôt (`"C:/Users/<user>/src/collie-board"` source `herd`, `"C:\\Users\\<user>\\src\\collie-board"` source `scan`) ; `isSafeDiffPath("C:/…/probe-windows-recon", "README.md")` → `false` (`true` avec la forme `\`). Tout ce qui compare ou indexe un `repoPath` est exposé (cartes ↔ herd, garde de diff). Corriger à la frontière : normaliser chaque chemin sorti de git (`path.resolve`) et comparer sans casse sur win32. | **M** (1–2 j avec tests) |
| **`/tmp`** | ❌ `galleryRoot()` = `` `/tmp/claude-${process.getuid?.() ?? 0}` `` → `\tmp\claude-0` sur Windows, qui n'existe pas : **galerie vide**. Le scratchpad de Claude Code Windows est sous `%TEMP%\claude\<projet>\<session>\scratchpad`. | **S** |
| **stateDir** | ✅ fonctionne : `~/.local/state/collie-board` → `C:\Users\<user>\.local\state\collie-board` (`board.db`, `audit.log`). ⚠️ Les `mode: 0o600/0o700` sont sans effet : le dossier hérite des ACL (`SYSTEM`, `Administrateurs`, l'utilisateur). Acceptable sur un poste mono-utilisateur ; un `%LOCALAPPDATA%\collie-board` serait plus idiomatique. | **S** |
| **realpath** | ✅ `artifacts`/`deliverables`/`gallery` passent par `realpath` des deux côtés ; pas d'écart observé hors des symlinks (non testables sans privilège). | — |
| **git** | ✅ via `bridge/git.ts` dès que `git` est dans le PATH du bridge **et** du serveur herdr (piège § 1). ⚠️ `core.autocrlf=true` : tout le checkout est en CRLF (`git ls-files --eol` → 728 `w/crlf`). | **S** (`.gitattributes` `eol=lf` ou `autocrlf=false` sur le nœud) |
| **Âge d'un process** | ⚠️ `processStartedAt` lit `/proc` ou `ps` → `null` sur Windows : `resolveForProcess` retombe sur l'heuristique de dossier (dégradé prévu, pas de crash). Un équivalent `Get-Process`/CIM ou `pane.process_info` rétablirait la désambiguïsation de deux agents dans un même dossier. | **S** |
| **`claudeCandidates`** | ⚠️ replis sans `.exe` et chemins Unix ; seul `Bun.which` fonctionne. Suffit tant que `claude` est dans le PATH du bridge. | **XS** |
| **Gate** | ⚠️ la commande de gate de l'opérateur doit être une commande Windows (`true` n'existe pas). Doc. | **XS** |

### Ce qui casse à l'installation

- **`bunx` absent avec winget** : `bun run build` → `bun: command not found: bunx`. winget déclare
  ses alias dans `%LOCALAPPDATA%\Microsoft\WinGet\Links`, qui reste **vide** sans Developer Mode
  (même cause que les `EPERM` de symlink), et n'est pas dans le PATH. Contournement de la
  reconnaissance : un `bunx.cmd` (`@bun x %*`). À installer plutôt via `irm bun.sh/install.ps1 | iex`
  (qui pose `bun.exe` et `bunx.exe` dans `~/.bun/bin`) — à confirmer.
- **Git** : `Git\cmd` seul est dans le PATH ; pas de `bash`, pas de `jq`.

---

## 3. Ce qui est en Bash

| Pièce | Taille | Sous Windows aujourd'hui | Port estimé |
|---|---|---|---|
| `herdr-plugin.toml` (build + 9 actions, toutes `["bash", "scripts/collie-board-ctl.sh", …]`) | 80 l. | ❌ `platforms = ["linux","macos"]` → herdr refuse proprement : `{"error":{"code":"platform_unsupported","message":"action 'herdr.collie-board.version' does not support the current platform (windows)"}}` (plugin lié avec `herdr plugin link`, puis délié). herdr accepte des `platforms` par action : on ajoute des actions `windows` qui pointent ailleurs. | **XS** une fois la cible choisie |
| `scripts/collie-board-ctl.sh` | 857 l. (+ 644 l. de `collie-board-ctl.test.sh`) | ⚠️ sous **Git Bash**, `version`, `url`, `status` marchent tels quels (`check-version.sh` aussi). `start` n'a ni systemd ni un `nohup` viable. Répartition : Tailscale serve (publication, empreinte, démontage du seul mapping géré) ≈ 330 l., systemd/supervision ≈ 90 l., setup/preflight ≈ 100 l., update/registry ≈ 80 l., build/version/url/status ≈ 120 l. | **PowerShell : L** (≈ 600–700 l. + tests Pester, 4–6 j). Supervision Windows = tâche planifiée « à l'ouverture de session, uniquement si l'utilisateur est connecté », **pas un service** (session 0 : pas de bureau, voir § 4). |
| `skills/collie-board/since-hook.sh` (hook `UserPromptSubmit` de Claude Code) | 16 l. | ❌ dépend de `jq`, absent de Git Bash | **XS** (≈ 20 l. PowerShell, ou un `since-hook.ts` lancé par `bun`, portable des deux côtés) |
| `scripts/git-hooks/pre-commit` | 80 l. | ✅ **tel quel** : Git for Windows l'exécute avec son `sh` et ses coreutils. Vérifié : un commit doc passe ; une modif de `scripts/` sans fragment est refusée (`✗ pre-commit: functional code changed but this branch has no fragment in changes/.`) | — |
| `scripts/git-hooks/pre-push` | 68 l. | ❌ le script tourne, mais le push est refusé. Sans `bunx` : `bun: command not found: bunx` / `✗ pre-push: backend typecheck failed`. Avec `bunx` : les typechecks passent, puis `1398 pass / 45 fail` → `✗ pre-push: backend tests failed — push aborted.` Ce rapport a été poussé avec `SKIP_TESTS=1`. | dépend des tests |
| `scripts/install-hooks.sh`, `install-skill.sh`, `check-untracked.sh`, `check-version.sh`, `release-notes.sh`, `capture-fixture.sh` | 7–41 l. chacun | ⚠️ marchent sous Git Bash sauf `install-skill.sh` (symlink → privilège) | **S** au total ; `install-skill` → copie ou jonction (`mklink /J`) au lieu d'un symlink |
| `systemd/collie-board.service` | 32 l. | sans objet | remplacé par la tâche planifiée |

**Alternative à un port PowerShell** : réécrire `collie-board-ctl.sh` en TypeScript sous Bun
(`scripts/ctl.ts`). Bun est déjà une dépendance dure ; une seule source pour Linux, macOS et Windows,
testable par `bun test` au lieu de `collie-board-ctl.test.sh`. Plus gros (≈ L+, 6–8 j) mais retire
le Bash du chemin d'exploitation au lieu d'en maintenir deux copies. À trancher dans l'ADR.

---

## 4. COM / SolidWorks

**SolidWorks n'est pas installé sur le poste : ouvrir SolidWorks, ouvrir une pièce et exporter une
capture n'ont pas pu être testés.** Office non plus (`Excel.Application`, `Word.Application` absents).
Le **mécanisme** a été vérifié avec le seul serveur COM d'appli graphique disponible,
`Shell.Application` (Explorer, hors processus, fenêtre visible), **depuis le pane PowerShell herdr**
— c'est-à-dire le chemin exact d'un agent :

```
user=<MACHINE>\<user> session=2 elevated=False
integrity=… Niveau obligatoire moyen … S-1-16-8192
apartment=STA
interactive=True
com_open=ok windows_before=1 found=True          ← New-Object -ComObject + ouverture d'une fenêtre
hwnd=919126 location=docs items=1                ← relecture d'état par le modèle objet
capture=1536x960 saved=True nonblack_samples=1092 ← capture du bureau réel
closed=ok                                        ← fermeture via COM
```

La capture montre bien la fenêtre Explorer sur le bureau de l'utilisateur. Correspondance avec
SolidWorks : `New-Object -ComObject SldWorks.Application` + `.Visible = $true` ↔ ouverture ;
`OpenDoc6` ↔ relecture ; `ModelDoc2.Extension.SaveAs` en `.png` ↔ capture.

**Pièges — constatés :**

- **La fenêtre s'est ouverte derrière** la fenêtre au premier plan (anti-vol de focus de Windows).
  Sans gêne pour l'API ; un agent qui « regarde » l'écran doit appeler un `SetForegroundWindow` ou
  passer par l'export de SolidWorks plutôt que par une capture d'écran.
- **Le pane est en STA, intégrité moyenne, session 2** : les bonnes conditions. Elles tiennent
  parce que herdr tourne dans la session de l'utilisateur.

**Pièges — connus, à vérifier sur un poste SolidWorks :**

- **Session** : un serveur herdr lancé comme service ou tâche « que l'utilisateur soit connecté ou
  non » tourne en **session 0**, sans bureau. SolidWorks s'y lance invisible, ou bloque sur un
  dialogue que personne ne voit. Le nœud doit être une tâche « à l'ouverture de session ».
- **Élévation** : COM sépare les niveaux d'intégrité. Un client élevé ne s'attache pas
  (`GetActiveObject`) à un SolidWorks non élevé, et inversement : il en lance un second. herdr le
  prévoit (`herdr server --allow-unelevated-clients`). Règle : tout non élevé.
- **PowerShell 7** n'a plus `[Runtime.InteropServices.Marshal]::GetActiveObject`, nécessaire pour
  s'attacher à une session SolidWorks déjà ouverte. Les panes herdr sont en Windows PowerShell 5.1,
  qui l'a. Le garder ainsi, ou passer par un petit utilitaire .NET Framework.
- **Licence et premiers lancements** : licence SolidNetWork, contrat de licence, écran d'accueil et
  dialogues « nouveautés » sont modaux. Tant qu'ils sont ouverts, les appels COM échouent
  (`RPC_E_CALL_REJECTED`). Il faut un premier lancement manuel, et un filtre de messages COM avec
  réessais dans les scripts.
- **Écran verrouillé** : un agent travaille souvent en l'absence de l'opérateur, donc session
  verrouillée. Une capture d'écran (`CopyFromScreen`) échoue alors ; le rendu interne de SolidWorks
  pour `SaveAs` en image reste à vérifier dans cet état.
- **Version de ProgID** : `SldWorks.Application` pointe vers la dernière version installée ;
  `SldWorks.Application.<n>` cible une version précise si plusieurs cohabitent.

**Effort** : COM lui-même **nul** (ça marche depuis un pane). Valider la chaîne SolidWorks réelle
demande **½ j sur un poste équipé** : refaire la sonde (ouvrir, `OpenDoc6`, `SaveAs` png, écran
verrouillé compris).

---

## 5. Tailscale — ✅

`tailscale serve` existe sous Windows (1.104.2) et publie un port local. Testé sur un serveur
jetable qui renvoie les en-têtes reçus, **pas sur le bridge**, qui tournait sans
`COLLIE_BOARD_TRUSTED_USER` :

```
> tailscale serve --bg --https=8443 8799
Available within your tailnet:
https://<machine>.<tailnet>.ts.net:8443/
|-- proxy http://127.0.0.1:8799
Serve started and running in the background.

> curl https://<machine>.<tailnet>.ts.net:8443/
{"ok":"collie-recon","host":"<machine>.<tailnet>.ts.net:8443","login":"<login tailnet>","name":"=?utf-8?q?…?="}
HTTP 200 in 49.078414s          ← premier appel : émission du certificat
HTTP 200 in 0.031666s           ← suivants

> tailscale serve --https=8443 off ; tailscale serve status
No serve config
```

`Tailscale-User-Login` est bien injecté, donc `checkAccess` et `COLLIE_BOARD_TRUSTED_USER`
fonctionnent comme sous Linux. Sous Git Bash, `collie-board-ctl.sh url` calcule déjà la bonne URL
`https://<machine>.<tailnet>.ts.net`. Le premier appel prend environ 50 s, le temps d'émettre le
certificat : le délai de `bridge_ready` ou du bandeau doit en tenir compte.

**Effort : nul** côté Tailscale. La logique de publication et de démontage de `collie-board-ctl.sh`
(≈ 330 l.) se porte avec le reste ([§ 3](#3-ce-qui-est-en-bash)).

---

## 6. Recommandation

**Nœud natif : faisable avec adaptations.** Pas « tel quel » : le bridge démarre et fonctionne,
mais il n'existe ni supervision ni action herdr sous Windows, et le bug de chemins `/` contre `\`
touche les cartes. Pas « infaisable » non plus : aucune impasse, et rien n'exige WSL.

Adaptations, par ordre de nécessité :

| # | Adaptation | Bloquant pour | Effort |
|---|---|---|---|
| 1 | Normaliser les chemins issus de git (`/` → `\`, comparaison insensible à la casse) dans `git.ts` / `repos.ts` | cartes, diff, liste des dépôts | M (1–2 j) |
| 2 | Supervision : tâche planifiée à l'ouverture de session (interactive, non élevée) pour herdr **et** le bridge, avec un environnement de logon frais | nœud qui survit à un redémarrage ; piège du PATH | S–M (1 j) |
| 3 | Actions `platforms = ["windows"]` dans `herdr-plugin.toml` + port de `collie-board-ctl.sh` (PowerShell, ou `ctl.ts` sous Bun, à trancher dans l'ADR) | `herdr plugin action invoke start/stop/update…` | L (4–6 j PS ; 6–8 j TS commun) |
| 4 | `galleryRoot()` sous `%TEMP%\claude` sur win32 | galerie | S |
| 5 | `since-hook` sans `jq` (TS sous Bun ou PowerShell) | contexte « depuis » de l'orchestrateur | XS |
| 6 | Tests portables : chemins via `path.join` dans les fakes, sauter les tests de symlink sans privilège, remplacer `bash`/`mkdir`/`chmod`/`true` par des appels Bun | `pre-push` utilisable, CI Windows | M (2 j) |
| 7 | `processStartedAt` sous Windows ; `claudeCandidates` avec `.exe` | deux agents dans un même dossier ; bridge hors PATH | S |
| 8 | Install : Bun via `bun.sh/install.ps1` (pour `bunx`), `core.autocrlf=false` ou `.gitattributes eol=lf` | build, SHA reproductibles | XS (doc) |
| 9 | `HERDR_API.md` : `C-c` accepté en 0.9.5 ; doc Windows (named pipe, sessions, piège du PATH) | — | XS |
| — | Validation SolidWorks réelle sur un poste équipé | lever la dernière inconnue | ½ j |

Total pour un nœud exploitable (1, 2, 3, 4, 5, 8) : environ **8 à 11 jours**. Rendre la suite de
tests verte sous Windows (6, 7) ajoute environ 3 jours.

### Reproduire

Les sondes de cette reconnaissance n'ont pas été versionnées ; ces commandes refont l'essentiel.

```powershell
irm https://herdr.dev/install.ps1 | iex ; herdr status        # → socket: %APPDATA%\herdr\herdr.sock
herdr api snapshot                                              # l'API répond
bun install ; bun test ./bridge ./scripts                       # 1403 pass / 54 fail
cd web ; bun install ; bun run test ; cd ..                     # 1823 pass
bun bridge/index.ts                                             # puis :
curl.exe -s http://127.0.0.1:8788/api/snapshot                  # agents[] et shellPanes[] remplis
```
