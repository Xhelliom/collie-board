# 5. Sans plugin herdr : installer, démarrer, mettre à jour le bridge

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

herdr-core et herdr-app n'ont **ni plugins, ni actions** **[doc : `hc --help`, `herdr-app --help` ;
herdr-app a des *mods* JS (UI dans la fenêtre), pas de registre d'actions invocables en CLI]**.
Aujourd'hui `herdr-plugin.toml` porte 9 actions : `setup`, `start`, `stop`, `restart`, `uninstall`,
`update`, `url`, `status`, `version` ; `ctl.ts` sait déjà faire le service systemd (Linux), et la
tâche planifiée (`schtasks`, Windows).

## Proposition

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
