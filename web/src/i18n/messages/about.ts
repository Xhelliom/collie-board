import { defineMessages } from "../define";

// Settings → About: how this Collie runs (bridge/about.ts). `about.<row>.<key>` says what is,
// `….fix` what to do when the row is not green.
export const about = defineMessages({
  "settings.tab.about": { en: "About", fr: "À propos" },
  "about.hint": {
    en: "How this Collie runs, read live from the bridge. Nothing secret is shown: a key is only said to be configured.",
    fr: "Comment tourne ce Collie, lu en direct sur le pont. Rien de secret n'est affiché : une clé est seulement dite configurée.",
  },
  "about.error": { en: "Couldn't read the bridge's state.", fr: "Impossible de lire l'état du pont." },
  "about.retry": { en: "Read again", fr: "Relire" },
  "about.state.ok": { en: "OK", fr: "OK" },
  "about.state.todo": { en: "To do", fr: "À faire" },
  "about.state.down": { en: "Broken", fr: "En panne" },
  "about.state.off": { en: "Not in use", fr: "Inutilisé" },

  "about.version": { en: "Collie", fr: "Collie" },
  "about.version.current": { en: "Version {current}, build {build} — up to date.", fr: "Version {current}, build {build} — à jour." },
  "about.version.update": { en: "Version {current}, build {build}. Version {latest} is out.", fr: "Version {current}, build {build}. La version {latest} est sortie." },
  "about.version.update.fix": {
    en: "Update from Herdr: <c>herdr plugin action invoke update --plugin herdr.collie-board</c>",
    fr: "Mettez à jour depuis Herdr : <c>herdr plugin action invoke update --plugin herdr.collie-board</c>",
  },
  "about.version.stale": { en: "Version {current}, build {build}. The bridge code changed on disk since it started.", fr: "Version {current}, build {build}. Le code du pont a changé sur le disque depuis son démarrage." },
  "about.version.stale.fix": {
    en: "Restart it: <c>herdr plugin action invoke restart --plugin herdr.collie-board</c>",
    fr: "Redémarrez-le : <c>herdr plugin action invoke restart --plugin herdr.collie-board</c>",
  },

  "about.engine": { en: "herdr engine", fr: "Moteur herdr" },
  "about.engine.hc": { en: "New agents start on herdr-core, version {version}.", fr: "Les nouveaux agents démarrent sur herdr-core, version {version}." },
  "about.engine.herdr09": { en: "New agents still start on herdr 0.9.", fr: "Les nouveaux agents démarrent encore sur herdr 0.9." },
  "about.engine.herdr09.fix": {
    en: "Think about migrating: start herdr-core (below), then move each running agent with its card's « Migrate to herdr-core » button.",
    fr: "Pensez à migrer : démarrez herdr-core (ci-dessous), puis passez chaque agent en cours avec le bouton « Migrer vers herdr-core » de sa carte.",
  },
  "about.engine.none": { en: "The bridge answers on no herdr socket.", fr: "Le pont ne répond sur aucun socket herdr." },
  "about.engine.none.fix": { en: "Open herdr-app, or run <c>hc server start</c> in a desktop terminal.", fr: "Ouvrez herdr-app, ou lancez <c>hc server start</c> dans un terminal du bureau." },

  "about.hc": { en: "herdr-core", fr: "herdr-core" },
  "about.hc.up": {
    en: "Answering on <c>{socket}</c>. Nothing starts it at boot: it comes up with its first client (herdr-app).",
    fr: "Répond sur <c>{socket}</c>. Rien ne le démarre au boot : il part avec son premier client (herdr-app).",
  },
  "about.hc.down": {
    en: "Not answering on <c>{socket}</c>. Nothing starts it at boot: it comes up with its first client (herdr-app).",
    fr: "Ne répond pas sur <c>{socket}</c>. Rien ne le démarre au boot : il part avec son premier client (herdr-app).",
  },
  "about.hc.down.fix": {
    en: "Open herdr-app, or add <c>hc server start</c> to your desktop autostart — never from an agent's pane. See the README, « herdr-core ».",
    fr: "Ouvrez herdr-app, ou ajoutez <c>hc server start</c> au démarrage de votre bureau — jamais depuis le pane d'un agent. Voir le README, « herdr-core ».",
  },

  "about.service": { en: "Service", fr: "Service" },
  "about.service.ok": { en: "Run by systemd --user, started at boot, lingering on: it survives your logout.", fr: "Lancé par systemd --user, activé au boot, lingering actif : il survit à votre déconnexion." },
  "about.service.manual": { en: "Not run by systemd: it stops with the terminal that started it.", fr: "Pas lancé par systemd : il s'arrête avec le terminal qui l'a démarré." },
  "about.service.manual.fix": { en: "Install it as a service: <c>herdr plugin action invoke start --plugin herdr.collie-board</c>", fr: "Installez-le en service : <c>herdr plugin action invoke start --plugin herdr.collie-board</c>" },
  "about.service.notEnabled": { en: "Run by systemd --user, but not enabled at boot.", fr: "Lancé par systemd --user, mais pas activé au boot." },
  "about.service.notEnabled.fix": { en: "Enable it: <c>herdr plugin action invoke start --plugin herdr.collie-board</c>", fr: "Activez-le : <c>herdr plugin action invoke start --plugin herdr.collie-board</c>" },
  "about.service.noLinger": { en: "Run by systemd --user and enabled, but lingering is off: it stops when you log out.", fr: "Lancé par systemd --user et activé, mais lingering inactif : il s'arrête quand vous vous déconnectez." },
  "about.service.noLinger.fix": { en: "Turn lingering on, once: <c>loginctl enable-linger</c>", fr: "Activez le lingering, une fois : <c>loginctl enable-linger</c>" },
  "about.service.na": { en: "No systemd on this system: started by hand or by the plugin.", fr: "Pas de systemd sur ce système : démarré à la main ou par le plugin." },

  "about.frontDoor": { en: "Front door", fr: "Porte d'entrée" },
  "about.frontDoor.tailscale": { en: "tailscale serve, managed by Collie (tailnet only, never funnel).", fr: "tailscale serve, géré par Collie (tailnet seulement, jamais funnel)." },
  "about.frontDoor.proxy": { en: "Your own reverse proxy (COLLIE_BOARD_SKIP_SERVE): Collie publishes nothing.", fr: "Votre propre proxy (COLLIE_BOARD_SKIP_SERVE) : Collie ne publie rien." },

  "about.push": { en: "Push notifications", fr: "Notifications push" },
  "about.push.on": { en: "VAPID keys configured; {devices} device(s) subscribed.", fr: "Clés VAPID configurées ; {devices} appareil(s) abonné(s)." },
  "about.push.none": { en: "VAPID keys configured, but no device subscribed.", fr: "Clés VAPID configurées, mais aucun appareil abonné." },
  "about.push.none.fix": { en: "Turn push on in the Notifications tab, on each phone.", fr: "Activez le push dans l'onglet Notifications, sur chaque téléphone." },
  "about.push.off": { en: "No VAPID keys: push is off.", fr: "Pas de clés VAPID : le push est coupé." },
  "about.push.off.fix": {
    en: "Generate them with <c>bunx web-push generate-vapid-keys</c>, set them in the .env, then restart.",
    fr: "Générez-les avec <c>bunx web-push generate-vapid-keys</c>, mettez-les dans le .env, puis redémarrez.",
  },

  "about.copilot": { en: "Copilot", fr: "Copilote" },
  "about.copilot.live": { en: "On, its pane is alive.", fr: "Activé, son pane est vivant." },
  "about.copilot.idle": { en: "On, no pane right now: it starts one at its next request.", fr: "Activé, pas de pane en ce moment : il en ouvre un à sa prochaine demande." },
  "about.copilot.off": { en: "Off (it spends your quota). <c>COLLIE_BOARD_COPILOT=on</c> turns it on.", fr: "Désactivé (il consomme votre quota). <c>COLLIE_BOARD_COPILOT=on</c> l'active." },

  "about.lead": { en: "Lot lead", fr: "Lead de lot" },
  "about.lead.none": { en: "No lot running, so no lead.", fr: "Aucun lot en cours, donc pas de lead." },
  "about.lead.live": { en: "A lot is running; its lead's pane is alive.", fr: "Un lot tourne ; le pane de son lead est vivant." },
  "about.lead.dead": { en: "A lot is running, but its lead's pane is gone.", fr: "Un lot tourne, mais le pane de son lead a disparu." },
  "about.lead.dead.fix": { en: "Open the lot on the Project page and restart it.", fr: "Ouvrez le lot sur la page Projet et relancez-le." },

  "about.peers": { en: "Peers", fr: "Pairs" },
  "about.peers.none": { en: "No paired machine.", fr: "Aucune machine appairée." },
  "about.peers.all": { en: "{up} of {total} paired machine(s) reachable.", fr: "{up} machine(s) appairée(s) sur {total} joignable(s)." },
  "about.peers.some": { en: "{up} of {total} reachable — not answering: {down}.", fr: "{up} sur {total} joignable(s) — ne répond pas : {down}." },
  "about.peers.some.fix": { en: "Check that Collie runs on that machine, then « Test the connection » in the Peers tab.", fr: "Vérifiez que Collie tourne sur cette machine, puis « Tester la connexion » dans l'onglet Pairs." },
});
