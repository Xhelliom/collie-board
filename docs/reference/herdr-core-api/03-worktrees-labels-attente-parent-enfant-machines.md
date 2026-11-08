# 3. Worktrees, labels, attente, parent/enfant, machines

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

## Worktrees — **manque dans hc** **[mesuré + doc]**

Aucune méthode `worktree.*` dans `hc schema`. herdr-app les fait dans son mod `worktree`
(`~/.config/herdr-app/mods/worktree/main.js`) en appelant **git** via `exec(...)` (= `machine.exec`),
rangés dans `~/.herdr/worktrees/<repo>/<branch>` **[lu]**. Pour nous : `worktree.create/open/remove`
→ `git worktree add/remove` dans `bridge/git.ts` (le seul endroit où l'on shell-out, déjà la règle),
puis `terminal.run {cwd}`.

## Labels **[mesuré]**

`--label k=v` au lancement, `hc label <t> k=v` après, filtre `terminal.list`/`events.subscribe`
`{labels:{k:v}}`. Libres, jamais interprétés **[doc]**. → **la carte peut vivre dans le terminal** :
`collie.card=<id>`. Plus besoin de retrouver la carte par le nom du pane. (`hc ls --json` affiche
`labels: null` alors que `hc get` les montre — bizarrerie du rendu `ls` **[mesuré]**.)

## Attendre **[mesuré]**

`hc wait <t>` (jusqu'à ≠ `working`), `send --wait` (le tour qu'on vient de lancer), `wait --output X`
(programmes simples), `wait --children all|any`. Remplace `agent.wait` et `pane.output_matched`.
Le bridge, lui, n'attend pas : il suit `events.subscribe`. Attente par défaut 180 s, `reason:timeout`
n'est pas un échec **[doc]**.

## Parent / enfant **[mesuré]**

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
  directement, sans fouiller les transcripts **[mesuré, ci-dessous]**.

**`--no-notify` et `children_of`, mesurés le 2026-11-06 (hc 0.1.18, Claude Code 2.1.319)** :

```
$ hc run --bg --no-parent --name nprobe-p --cwd <dossier neuf> -- claude --model haiku
$ hc keys nprobe-p down enter                         # écran de confiance → turn 0, idle
$ hc run --bg --parent nprobe-p --name nprobe-a -- sh -c 'sleep 3; echo fini-a'
$ hc get nprobe-a        {"parent":"t1d","notify":true}
  15 s plus tard : nprobe-p turn 1, done ; écran « <hc>t1j nprobe-a exited (exit 0)… fini-a </hc> » + une réponse
$ hc run --bg --parent nprobe-p --no-notify --name nprobe-b -- sh -c 'sleep 3; echo fini-b'
$ hc get nprobe-b        {"parent":"t1d","notify":false}
  12 s plus tard : nprobe-p toujours turn 1, « fini-b » absent de l'écran
```

- La note **coûte bien un tour** (turn 0 → 1, une réponse de Claude) ; `--no-notify` l'empêche
  (turn inchangé). Un parent qui n'est pas un agent (`cat`) ne reçoit rien.
- **`notify` est une propriété de l'enfant, fixée par qui le lance** (`no_notify` de `terminal.run`).
  Le bridge n'a **aucun levier** sur un enfant que l'agent lance lui-même : pas de variable
  d'environnement lue par le CLI pour ce défaut, pas de réglage côté parent, pas de méthode pour le
  changer après coup (`terminal.label` ne touche que les labels). Seul autre interrupteur :
  `notes = false` global dans la config du core, qui appartient à l'opérateur. Claude Code n'appelle
  jamais `hc` de lui-même (aucune occurrence de `HC_TERMINAL_ID` ou de `--no-notify` dans son binaire)
  : ses sous-agents `Agent` restent internes, un enfant n'existe que si l'agent tape `hc run`.
  **D'où** : une carte lancée sous hc reçoit dans son prompt la consigne `hc run --no-notify`
  (`HC_NO_NOTIFY_HINT`, `bridge/mux/hc.ts`) ; sous 0.9 le prompt ne change pas.
- `terminal.list` **n'a pas** de filtre `children_of` (seuls `all` et `labels`) — `events.subscribe`
  l'a. Mais chaque terminal de la liste porte `parent` : le bridge lit les enfants vivants d'un
  terminal dans le `terminal.list` qu'il fait déjà à chaque instantané (`hcChildren`), sans appel de
  plus. Leurs noms (label `collie.name`, sinon `name`, sinon l'adresse) deviennent les `subagents` du
  pane, affichés comme aujourd'hui ; sous hc le transcript n'est plus lu pour eux.

## Variables d'environnement d'un terminal **[mesuré]**

```
$ hc run --no-parent --name envp -- sh -c 'env | grep -E "HC_|HERDR|TERM"'
HC_SCOPE=555961-9a84…   HC_TERMINAL_ID=t11   HC_TERMINAL_SOCKET=/run/user/1001/herdr-core/default.sock
TERM_PROGRAM=ghostty    TERM=xterm-256color  COLORTERM=truecolor
```

**Plus de `HERDR_PANE_ID`** (le programme reçoit l'environnement de la session, pas celui de
l'appelant **[doc]**). Tout ce qui relaie `HERDR_PANE_ID` en `x-collie-pane` (MCP `bridge/mcp.ts`, skill,
`since-hook.ts`, le curl du prompt de carte) doit lire `HC_TERMINAL_ID` — sinon un agent devient
`human` pour l'ADR 0010.

## `hc machine` vs nos pairs (ADR 0048/0051)

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

## Persistance et reprise **[doc]**

`--keep` : programme perdu (crash du core, reboot) → **un shell** au même endroit, **la commande n'est
jamais relancée**. Exit ou kill : fini pour de bon. `server restart` garde les programmes. → un agent
de carte survit à un redémarrage du core, pas à un reboot (là, notre handoff reste nécessaire).

## Reprendre sous hc une conversation Claude née ailleurs (`claude --resume`) **[mesuré le 2026-11-06]**

hc 0.1.18, Claude Code 2.1.319. Session créée hors hc (`claude -p --session-id $SID "Retiens ce mot
secret : PAMPLEMOUSSE-42…"`), puis reprise dans le **même cwd** :

```
$ hc run --bg --no-parent --name probe-resume --cwd $WT claude --resume $SID
0,1 s state null · 0,6 s null · 1,1 s idle turn 0         ← prêt en ~1 s, l'historique est à l'écran
$ hc send --if idle probe-resume "Quel était le mot secret ? Réponds par le mot seul."
{"started":true,"status":"idle","turn":0}
$ hc wait probe-resume  →  {"status":"done","turn":1}     écran : ● PAMPLEMOUSSE-42
```

- **La conversation est rendue** : l'écran montre les tours précédents et Claude répond avec le
  contexte. Aucun écran de confiance (cwd déjà approuvé).
- **Même id de session** : `$SID.jsonl` passe de 39 à 62 lignes, aucun nouveau fichier. Le
  transcript, la jauge de contexte et `agentSessionId` suivent l'agent sans rien remapper.
- **Piège d'environnement** : le core hérite l'environnement de **celui qui l'a démarré**, et
  `terminal.run {env}` ne fait qu'ajouter. Ici le core avait été démarré depuis un pane Claude :
  chaque terminal recevait `CLAUDE_CODE_CHILD_SESSION=1` (→ Claude n'écrit **aucun transcript**,
  bandeau « Transcript saving is off ») et un `HERDR_PANE_ID` périmé. `env -u` côté client n'y change
  rien ; `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` dans l'env du lancement rétablit l'écriture
  (mesuré : bandeau absent, transcript complété). → démarrer le core hors de tout agent (service de
  l'OS), ou poser cette variable dans `terminal.run {env}`.

## Stockage `doc.get/set` **[mesuré : param `name` requis]**

Document JSON opaque versionné (≤ 1 MiB), évènement `doc` à chaque écriture. **[supposé]** inutile pour
nous (le board a sa base) ; à ne pas utiliser pour l'état durable (règle « card durable »).

---
