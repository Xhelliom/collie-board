# 7. Windows (Collie Windows, ADR 0050)

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

**État au 2026-11-06 : mesuré sur le poste** (`Dell-5550-Stef`, Windows 11 Pro 10.0.26200, depuis une
carte Collie Board qui tourne dessus). La première rédaction (2026-11-05, #250) venait de l'hôte Linux
sans accès shell : ce qui suit sépare ce qui était **lu**, ce qui a été **mesuré** depuis, et la sonde
telle qu'elle a tourné.

**Verdict.** Sous Windows, hc se comporte comme sous Linux pour tout ce qui compte au bridge : Claude
Code publie son statut OSC 7501 à travers ConPTY (`idle`/`working`/`done`/`blocked` avec `kind`+`msg`),
`hc send` dit s'il a été pris, l'écran de confiance tue Claude sur un `Enter` aveugle, et **Bun parle
JSON-RPC au named pipe avec `node:net`, sur une connexion persistante**. Aucun obstacle Windows propre
n'a été trouvé pour une V2 du bridge sur hc.

## Ce qui est lu **[doc]**

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

## Ce qui a été mesuré (2026-11-06)

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

## Sonde lancée sur le poste Windows

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
