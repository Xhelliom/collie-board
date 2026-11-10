# 2. Envoyer un prompt : les courses de herdr 0.9 existent-elles encore ?

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

Rappel (ARCHITECTURE.md §9, `bridge/cards.ts` `launchAgent`/`promptAndConfirm`) : (a) l'agent n'est
pas prêt, (b) le prompt est tapé mais pas soumis, (c) l'écran de confiance avale le prompt.

## `hc send` attend lui-même la disponibilité **[mesuré]**

`terminal.send` : « Paste text and press Enter, once nobody has typed for ~3 s » **[doc]**. Envoi
immédiatement après `hc run --bg claude` (dossier déjà approuvé) :

```
$ hc run --bg --no-parent --name probe4 --cwd $WT claude >/dev/null; time hc send probe4 "Réponds juste: PRET"
{"started":true,"status":"idle","turn":0}
… 1,840 total
(6 s plus tard) {"status":{"app":"claude-code","state":"done"},"turn":1}   écran : "● PRET"
```

## (b) Prompt tapé mais pas soumis : **existe encore, 1 fois sur 3**, mais il se voit **[mesuré]**

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

## (c) Écran de confiance : **existe encore, et il est devenu destructeur** **[mesuré]**

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

## Tâche passée au lancement **[mesuré]**

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

## Envois pendant un tour **[mesuré]**

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

## `hc read` **[mesuré]**

Texte brut, écran + historique (`--lines N`, `--lines 0` = écran seul). Marche sur un terminal fini
(`hc read probe2` après `kill` → 2 lignes). Pas de couleurs : **[supposé]** il faudrait `terminal.attach`
(flux brut) pour garder notre rendu ANSI.

---
