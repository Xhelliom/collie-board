# Après un redémarrage, qui démarre herdr-core ?

**Statut :** ✅ tranché le 14/11/2026 — option 4 : Collie ne démarre pas herdr-core, on documente.

## La question

Le PC a redémarré, puis l'app herdr 0.9 a été lancée sans terminal. herdr-core semblait ne démarrer
qu'au lancement de l'app. Qui démarre herdr-core au boot ? Que fait Collie en attendant ? Le correctif
revient-il à herdr (rapport en amont) ou à notre installation (`scripts/`) ?

## Ce qu'on a trouvé (relevé sur la machine, boot à 14:05:25)

- **Personne ne démarre herdr-core au boot.** Il n'existe ni unité systemd persistante ni entrée
  d'autostart pour lui (`systemctl --user list-unit-files`, `~/.config/autostart/`). La seule unité
  activée est `collie-board.service`.
- **herdr-core démarre à la demande, au premier client.** Le premier client a été `herdr-app`
  (14:06:44). herdr-core s'est alors lancé lui-même par `systemd-run`, dans des unités **transitoires**
  `hc-serve-*.service` et `hc-hold-*` (`/run/user/1001/systemd/transient/`), rattachées à
  `systemd --user`. N'importe quel client (`hc`, `herdr`, l'app) l'aurait démarré de la même façon.
- **C'est voulu par herdr, pas un bug.** `hc server status` répond `installed_by: null` (« installation
  ordinaire, remplaçable ») et `keeps_running_after_logout: true` (le lingering est actif) : herdr-core
  survit à la déconnexion, mais rien n'est prévu pour qu'il démarre avant le premier client. `hc` sait
  `server start|stop|status|restart`, mais n'a pas de commande pour s'installer comme service.
- **Collie attend sans casser.** `collie-board.service` (lingering) démarre à 14:06:17, sans herdr-core.
  Le bridge le signale, réessaie à chaque poll et se reconnecte tout seul quand herdr-core arrive
  (14:06:55 « stream up »). Mais entre le boot et la première ouverture de l'app, **le téléphone ne
  voit pas le troupeau et ne peut lancer aucune carte** : pour l'opérateur qui n'a que son téléphone,
  il n'y a aucun moyen de démarrer herdr-core.
- **Constat annexe : le message de démarrage cite le mauvais socket.** Le bridge parle à
  `$XDG_RUNTIME_DIR/herdr-core/default.sock` (`hcSocketPath`, vérifié avec `ss` : le bridge est
  connecté à ce socket). Pourtant, le message de démarrage (`bridge/index.ts:450`) cite
  `cfg.socketPath` = `~/.config/herdr/herdr.sock`, l'ancien socket de herdr 0.9, absent sur cette
  machine. `collie-board-ctl.sh` écrit encore ce chemin dans l'unité. Ce message égare celui qui
  cherche la panne.

## Les options

1. **Notre installation démarre herdr-core** : l'unité générée par `collie-board-ctl.sh` lance
   `herdr-core server start` avant le bridge (`ExecStartPre=-…`, sans bloquer si la commande échoue).
   Une seule ligne. Avec le lingering, le troupeau est prêt dès le boot, même sans session ouverte.
   Contrepartie : Collie se met à démarrer un processus qui n'est pas à lui, alors que jusqu'ici il se
   contentait de s'y connecter.
2. **Démarrer herdr-core depuis le téléphone, sur demande** : quand le socket manque, le bridge propose
   « Démarrer herdr » (il exécute `herdr-core server start`). Rien ne démarre en silence, mais il faut
   une route, un bouton et un écran.
3. **Rapport pour herdr** : demander une installation comme service (`hc server enable`, une unité
   systemd ou un autostart). Utile à tous, mais pas sous notre contrôle : ce n'est pas un défaut, c'est
   une fonctionnalité qui manque.
4. **Ne rien faire, documenter** : « après un redémarrage, ouvrez l'app herdr ou lancez `hc ls` ».

## Décision (14/11/2026)

**Option 4, décision de l'opérateur.** Collie ne démarre pas herdr-core lui-même : il continue de se
connecter au socket et d'attendre. La marche à suivre après un redémarrage est documentée dans le
[README](../../README.md#troubleshooting) et dans
[`12-troubleshooting.md`](../usage/12-troubleshooting.md) : ouvrir l'app herdr, ou lancer
`hc server start` (ou `hc ls`) depuis un terminal du bureau. Les options 1 et 2 sont écartées ; la
recommandation ci-dessous est gardée pour mémoire.

Le constat annexe (message de démarrage qui citait l'ancien socket) est corrigé par #425 : le bridge
cite désormais le socket herdr-core sondé et `hc server start`.

## Recommandation (avant décision)

**Le correctif est chez nous (option 1), et un rapport à herdr est facultatif (option 3).** herdr-core
fait ce pour quoi il est conçu. C'est **notre** installation qui promet un bridge joignable dès le
boot, et elle doit tenir cette promesse jusqu'au bout. L'option 1 coûte une ligne dans
`collie-board-ctl.sh` et un test dans `collie-board-ctl.test.sh`. `server start` réutilise le
mécanisme de herdr lui-même (`systemd-run`, unités transitoires) : on ne crée aucune unité concurrente.
Indépendamment, il faut corriger le message de démarrage pour qu'il cite le socket réellement attendu.

**Question pour l'opérateur :** acceptez-vous que Collie démarre herdr-core au boot (option 1), ou
préférez-vous garder la main et ne le démarrer que depuis le téléphone (option 2) ? Les cartes de
suivi supposent l'option 1. Si vous choisissez l'option 2, la carte « démarrer au boot » devient
« bouton Démarrer herdr ».

**Pas vérifié :** le comportement de `herdr-core server start` lancé depuis une unité au tout début du
boot, sans session graphique. Il faudra le tester au premier redémarrage qui suivra le correctif.
