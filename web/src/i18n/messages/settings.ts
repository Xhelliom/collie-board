import { defineMessages } from "../define";

// The Settings screen and the controls it mounts (ADR 0024, amended: Settings is no longer exempt).
export const settings = defineMessages({
  "settings.title": { en: "Settings", fr: "Réglages" },
  "settings.tabs": { en: "Settings sections", fr: "Sections des réglages" },
  "settings.tab.display": { en: "Display", fr: "Affichage" },
  "settings.tab.notifications": { en: "Notifications", fr: "Notifications" },
  "settings.tab.agents": { en: "Agents", fr: "Agents" },
  "settings.tab.system": { en: "System", fr: "Système" },

  "settings.gallery.title": { en: "Gallery", fr: "Galerie" },
  "settings.gallery.hint": { en: "Images your agents left in their scratchpads.", fr: "Les images que vos agents ont laissées dans leurs brouillons." },

  "settings.statusLine.title": { en: "Agent status line", fr: "Ligne d'état de l'agent" },
  "settings.statusLine.hint": {
    en: "The agent's status lines above the reply box (mode, hooks…). On this device.",
    fr: "Les lignes d'état de l'agent au-dessus de la zone de réponse (mode, hooks…). Sur cet appareil.",
  },

  "settings.push.title": { en: "Push notifications", fr: "Notifications push" },
  "settings.push.hint": { en: "Get a notification when an agent needs you.", fr: "Être notifié quand un agent a besoin de vous." },
  "settings.push.err.insecure": { en: "Push needs an HTTPS connection.", fr: "Le push exige une connexion HTTPS." },
  "settings.push.err.server-off": {
    en: "Push isn't configured on the bridge (no VAPID keys).",
    fr: "Le push n'est pas configuré sur le pont (pas de clés VAPID).",
  },
  "settings.push.err.denied": {
    en: "Notifications are blocked — enable them in your browser settings.",
    fr: "Les notifications sont bloquées — activez-les dans les réglages du navigateur.",
  },
  "settings.push.err.unsupported": { en: "This browser doesn't support push notifications.", fr: "Ce navigateur ne gère pas les notifications push." },
  "settings.push.err.default": { en: "Couldn't enable push notifications.", fr: "Impossible d'activer les notifications push." },
  "settings.push.note.insecure": {
    en: "Unavailable over plain HTTP — serve Collie over HTTPS to enable push.",
    fr: "Indisponible en HTTP simple — servez Collie en HTTPS pour activer le push.",
  },
  "settings.push.note.server-off": {
    en: "The bridge has no VAPID keys configured, so push is disabled server-side.",
    fr: "Le pont n'a pas de clés VAPID : le push est désactivé côté serveur.",
  },
  "settings.push.note.denied": {
    en: "Notifications are blocked for this site. Re-enable them in your browser settings.",
    fr: "Les notifications sont bloquées pour ce site. Réactivez-les dans les réglages du navigateur.",
  },

  "settings.theme.title": { en: "Appearance", fr: "Apparence" },
  "settings.theme.hint": { en: "Light, dark, or follow your device.", fr: "Clair, sombre, ou selon votre appareil." },
  "settings.theme.light": { en: "Light", fr: "Clair" },
  "settings.theme.dark": { en: "Dark", fr: "Sombre" },
  "settings.theme.system": { en: "System", fr: "Système" },

  "settings.notify.title": { en: "Notify when", fr: "Me notifier quand" },
  "settings.notify.hint": { en: "Applies to all devices.", fr: "S'applique à tous les appareils." },
  "settings.notify.blocked": { en: "Needs input", fr: "Une réponse est attendue" },
  "settings.notify.blocked.hint": { en: "an agent is waiting on you", fr: "un agent vous attend" },
  "settings.notify.done": { en: "Finished", fr: "Terminé" },
  "settings.notify.done.hint": { en: "an agent completes its task", fr: "un agent termine sa tâche" },
  "settings.notify.board": { en: "Board alerts", fr: "Alertes du plateau" },
  "settings.notify.board.hint": {
    en: "a card's agent vanished, or a handoff never landed",
    fr: "l'agent d'une carte a disparu, ou un handoff n'est jamais arrivé",
  },
  "settings.notify.ready": { en: "Unblocked", fr: "Débloquée" },
  "settings.notify.ready.hint": {
    en: "a card can start — whatever it waited on is finished",
    fr: "une carte peut démarrer — ce qu'elle attendait est terminé",
  },
  "settings.notify.lots": { en: "Lots: let the orchestrator notify", fr: "Lots : laisser l'orchestrateur notifier" },
  "settings.notify.lots.hint": {
    en: "during a lot, its cards stay in the bell; the orchestrator sends the one push",
    fr: "pendant un lot, ses cartes restent dans la cloche ; l'orchestrateur envoie le seul push",
  },
  "settings.notify.updates": { en: "App updates", fr: "Mises à jour de l'app" },
  "settings.notify.updates.hint": { en: "a new Collie version is available", fr: "une nouvelle version de Collie est disponible" },
  "settings.notify.copilotSubtitle": { en: "Copilot rephrase", fr: "Reformulation par le copilote" },
  "settings.notify.copilotSubtitle.hint": {
    en: "the copilot rewrites the subtitle in one sentence — spends its quota",
    fr: "le copilote réécrit le sous-titre en une phrase — consomme son quota",
  },

  "settings.snooze.title": { en: "Do not disturb", fr: "Ne pas déranger" },
  "settings.snooze.on": { en: "Snoozed until {time} — no pushes until then.", fr: "En pause jusqu'à {time} — aucun push d'ici là." },
  "settings.snooze.off": { en: "Pause all push notifications for a while.", fr: "Suspendre toutes les notifications push un moment." },
  "settings.snooze.resume": { en: "Resume now", fr: "Reprendre maintenant" },

  "settings.maxAgents.title": { en: "Agents at once", fr: "Agents simultanés" },
  "settings.maxAgents.hint": {
    en: "Starting a card past this limit is refused until one finishes or is handed off.",
    fr: "Démarrer une carte au-delà de cette limite est refusé tant qu'un agent n'a pas fini ou été passé en handoff.",
  },
  "settings.maxAgents.fewer": { en: "One agent fewer", fr: "Un agent de moins" },
  "settings.maxAgents.more": { en: "One agent more", fr: "Un agent de plus" },

  "settings.followUps.title": { en: "Follow-up cards", fr: "Cartes de suite" },
  "settings.followUps.hint": {
    en: "When a card is done, add what the review found still undone to the backlog. Those cards are marked <b>auto</b>, and the board filters on it.",
    fr: "Quand une carte est terminée, ajoute au backlog ce que la relecture a trouvé encore à faire. Ces cartes sont marquées <b>auto</b>, et le plateau filtre dessus.",
  },
  "settings.followUps.test": { en: "Testing to do", fr: "Tests à faire" },
  "settings.followUps.feature": { en: "Missing feature", fr: "Fonctionnalité manquante" },
  "settings.followUps.bug": { en: "Bug found", fr: "Bug trouvé" },
  "settings.followUps.docs": { en: "Docs to write", fr: "Doc à écrire" },
  "settings.followUps.chore": { en: "Chore", fr: "Corvée" },
  "settings.followUps.explore": { en: "Question to explore", fr: "Question à explorer" },

  "settings.autoHandoff.title": { en: "Auto handoff", fr: "Handoff automatique" },
  "settings.autoHandoff.hint": {
    en: "When a Claude card session has sat idle for 4 minutes, have it write its handoff note before its prompt cache expires. Coming back later, start fresh from the note instead of reloading the whole conversation. Each card can override this.",
    fr: "Quand une session de carte Claude reste inactive 4 minutes, elle écrit sa note de handoff avant l'expiration de son cache de prompt. En revenant plus tard, repartez de la note plutôt que de recharger toute la conversation. Chaque carte peut le contourner.",
  },
  "settings.resume.notice": {
    en: "Cache expired: the next message will reload the whole conversation. A handoff was written before it expired.",
    fr: "Cache expiré : le prochain message rechargera toute la conversation. Un handoff a été écrit avant l'expiration.",
  },
  "settings.resume.accept": { en: "Restart from the handoff", fr: "Repartir du handoff" },
  "settings.resume.decline": { en: "Continue here", fr: "Continuer ici" },

  "settings.backup.title": { en: "Backup", fr: "Sauvegarde" },
  "settings.backup.hint": {
    en: "Download your cards, history and preferences as one JSON file — or restore from one.",
    fr: "Téléchargez vos cartes, votre historique et vos préférences dans un seul fichier JSON — ou restaurez-en un.",
  },
  "settings.backup.failed": { en: "Couldn't back up.", fr: "Sauvegarde impossible." },
  "settings.backup.restoreFailed": { en: "Couldn't restore.", fr: "Restauration impossible." },
  "settings.backup.preparing": { en: "Preparing…", fr: "Préparation…" },
  "settings.backup.download": { en: "Download backup", fr: "Télécharger la sauvegarde" },
  "settings.backup.restoring": { en: "Restoring…", fr: "Restauration…" },
  "settings.backup.confirm": { en: "Tap again to replace", fr: "Touchez encore pour remplacer" },
  "settings.backup.restoreFile": { en: "Restore {name}", fr: "Restaurer {name}" },
  "settings.backup.restore": { en: "Restore…", fr: "Restaurer…" },
  "settings.backup.readOnly": { en: "This device isn't allowed to export or restore.", fr: "Cet appareil n'a pas le droit d'exporter ni de restaurer." },
  "settings.backup.saved": { en: "Saved {name}", fr: "Enregistré : {name}" },
  "settings.backup.warn": {
    en: "This replaces the board and every stored preference. The bridge exports the current state to its <c>backups/</c> folder first.",
    fr: "Cela remplace le plateau et toutes les préférences enregistrées. Le pont exporte d'abord l'état actuel dans son dossier <c>backups/</c>.",
  },
  "settings.backup.restored": {
    en: "Restored {rows} rows, {files} files and {prefs} local preferences.",
    fr: "{rows} lignes, {files} fichiers et {prefs} préférences locales restaurés.",
  },
  "settings.backup.previous": { en: "Previous state saved on the host at <c>{path}</c>.", fr: "État précédent sauvegardé sur l'hôte dans <c>{path}</c>." },
  "settings.backup.restart": {
    en: "Restart the bridge to pick up the notification settings: <c>{command}</c>",
    fr: "Redémarrez le pont pour prendre en compte les réglages de notification : <c>{command}</c>",
  },
  "settings.backup.reload": { en: "Reload the app", fr: "Recharger l'app" },

  "settings.conn.title": { en: "Connection", fr: "Connexion" },
  "settings.conn.hint": { en: "Diagnostics for this device.", fr: "Diagnostic de cet appareil." },
  "settings.conn.endpoint": { en: "Endpoint", fr: "Point d'accès" },
  "settings.conn.secure": { en: "Secure context", fr: "Contexte sécurisé" },
  "settings.conn.yes": { en: "Yes", fr: "Oui" },
  "settings.conn.no": { en: "No (plain HTTP)", fr: "Non (HTTP simple)" },
  "settings.conn.bridge": { en: "Bridge", fr: "Pont" },
  "settings.conn.connected": { en: "Connected", fr: "Connecté" },
  "settings.conn.offline": { en: "Herdr offline", fr: "Herdr hors ligne" },
  "settings.conn.connecting": { en: "Connecting…", fr: "Connexion…" },
  "settings.conn.device": { en: "Device access", fr: "Accès de l'appareil" },
  "settings.conn.notEnforced": { en: "Not enforced", fr: "Non appliqué" },
  "settings.conn.full": { en: "Full access · {device}", fr: "Accès complet · {device}" },
  "settings.conn.fullLocal": { en: "Full access (local)", fr: "Accès complet (local)" },
  "settings.conn.ro": { en: "Read-only · {device}", fr: "Lecture seule · {device}" },
  "settings.conn.roBare": { en: "Read-only", fr: "Lecture seule" },
  "settings.conn.build": { en: "Server build", fr: "Build du serveur" },

  "settings.mcp.title": { en: "MCP server", fr: "Serveur MCP" },
  "settings.mcp.hint": {
    en: "stdio, to run on the bridge's machine; a remote client goes through the Multi-machine phase.",
    fr: "stdio, à lancer sur la machine du bridge ; un client distant passe par la phase Multi-machine.",
  },
  "settings.mcp.device": {
    en: "This deployment gates writes on a device header — replace my-laptop with an authorised device:",
    fr: "Ce déploiement filtre les écritures par en-tête d'appareil — remplacez my-laptop par un appareil autorisé :",
  },
  "settings.mcp.copy": { en: "Copy command: {command}", fr: "Copier la commande : {command}" },
  "settings.mcp.copied": { en: "Copied", fr: "Copié" },
  "settings.mcp.read": { en: "Read", fr: "Lecture" },
  "settings.mcp.action": { en: "Action", fr: "Action" },
  "settings.mcp.failed": { en: "Couldn't load the MCP setup.", fr: "Impossible de charger la configuration MCP." },

  "settings.updates.title": { en: "Updates", fr: "Mises à jour" },
  "settings.updates.none": { en: "Check whether a new Collie version is available.", fr: "Vérifier si une nouvelle version de Collie est disponible." },
  "settings.updates.running": { en: "Running v{version}", fr: "Version v{version} en cours" },
  "settings.updates.checked": { en: " · checked {ago}", fr: " · vérifié {ago}" },
  "settings.updates.checking": { en: "Checking…", fr: "Vérification…" },
  "settings.updates.check": { en: "Check for updates", fr: "Vérifier les mises à jour" },
  "settings.updates.failed": { en: "Couldn't check.", fr: "Vérification impossible." },
  "settings.updates.upToDate": { en: "Up to date", fr: "À jour" },
  "settings.updates.copy": { en: "Copy command: {command}", fr: "Copier la commande : {command}" },
  "settings.build.updating": { en: "updating…", fr: "mise à jour…" },
  "settings.build.stale": { en: "new build — tap to update", fr: "nouveau build — touchez pour mettre à jour" },
});
