# 1. Le statut de Claude Code dans hc

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

## Verdict : il remonte **sans aucun réglage**, et il est plus riche que celui de herdr 0.9

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

## Ce qui remonte, tour par tour **[mesuré]** (`hc events`, terminal `probe2` = `t3`)

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
