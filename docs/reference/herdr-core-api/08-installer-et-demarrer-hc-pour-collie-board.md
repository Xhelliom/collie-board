# 8. Installer et démarrer hc pour Collie Board

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

Depuis la phase 4 d'ADR 0052, un **nouveau** lancement va sous hc dès que le core répond
(`COLLIE_BOARD_MUX=auto`, le défaut), et sous herdr 0.9 sinon — le bouton Démarrer de la carte le
dit. Le bridge lit les deux moteurs ; il **ne démarre jamais le core**, il compose seulement sa socket.

**Règle : le core est démarré par herdr-app ou par la session de bureau, jamais par un agent.** Il
hérite de l'environnement de qui le démarre et le passe à chaque terminal (§3, « Piège
d'environnement », et §7) : démarré depuis un pane Claude Code, il transmet
`CLAUDE_CODE_CHILD_SESSION`, et chaque Claude lancé ensuite **n'écrit aucun transcript** (historique,
jauge de contexte, reprise et migration perdus) et reçoit un `HERDR_PANE_ID` périmé. Un agent ne lance
donc ni `hc server start`, ni, sous Linux, une commande `hc` qui démarrerait un core absent **[supposé,
§5]**.

## Linux

1. Installer herdr-app, qui installe herdr-core avec lui (herdr.dev) : `herdr-app`, `hc` et
   `herdr-core` dans `~/.local/bin` **[mesuré sur l'hôte de déploiement]**.
2. Démarrer le core depuis le bureau : ouvrir herdr-app, ou mettre `hc server start` dans le
   démarrage automatique de la session (`~/.config/autostart/*.desktop`).
3. Vérifier : `hc server status` dans un terminal ordinaire. Socket :
   `$XDG_RUNTIME_DIR/herdr-core/default.sock` **[mesuré, §0]** ; sinon `COLLIE_BOARD_HC_SOCKET`.

## Windows

1. PowerShell : `irm https://releases.herdr.dev/app/install.ps1 | iex` — herdr-app, puis herdr-core
   s'il manque (Windows 10 1803+ ; Git for Windows pour `sh`) **[mesuré, §7]**.
2. Démarrer le core dans la session de bureau : ouvrir herdr-app, ou `hc server start` dans un
   terminal de bureau normal — pas par SSH, pas depuis un agent. Sous Windows `hc server status` n'en
   démarre jamais **[doc, §7]**.
3. Vérifier : `hc server status`. Le bridge compose `\\.\pipe\herdr-core-<USERNAME>-default.sock`
   **[mesuré, §7 : `herdr-core-steph-default.sock`]** ; sinon `COLLIE_BOARD_HC_SOCKET`.

Le manifeste `herdr-plugin.toml` et ses actions restent l'installation et la mise à jour du bridge
tant que herdr 0.9 est supporté (phase 5).
