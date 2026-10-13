import { defineMessages } from "../define";

// The chrome mounted around every route: idle cover, connection bars, boot splash, error screen,
// toasts, and the aria-labels of the shared primitives.
export const shell = defineMessages({
  "idle.label": { en: "Collie paused", fr: "Collie en pause" },
  "idle.catchingUp": { en: "Updating…", fr: "Mise à jour…" },
  "idle.catchingUpBody": { en: "Fetching the herd's state.", fr: "Récupération de l'état de la meute." },
  "idle.paused": { en: "Paused", fr: "En pause" },
  "idle.pausedBody": {
    en: "Updates stopped while this screen sat idle — what is behind it is frozen. Resuming picks up exactly where you left off.",
    fr: "Les mises à jour se sont arrêtées pendant que cet écran restait inactif — ce qu'il y a derrière est figé. La reprise repart exactement où vous en étiez.",
  },
  "idle.resume": { en: "Tap to resume", fr: "Toucher pour reprendre" },
  "conn.connected": { en: "Connected", fr: "Connecté" },
  "conn.reconnecting": { en: "Reconnecting…", fr: "Reconnexion…" },
  "conn.herdrDown": { en: "Herdr is down on the host", fr: "Herdr est arrêté sur l'hôte" },
  "conn.offline": { en: "Offline — can't reach Collie", fr: "Hors ligne — Collie injoignable" },
  "conn.unreachable": { en: "Can't reach Collie", fr: "Collie injoignable" },
  "conn.accessRefused": {
    en: "Access refused. This is not a connection problem.",
    fr: "Accès refusé. Ce n'est pas un problème de connexion.",
  },
  "conn.reload": { en: "Reload", fr: "Recharger" },
  "conn.retry": { en: "Retry", fr: "Réessayer" },
  "boot.loading": { en: "Loading", fr: "Chargement" },
  "boot.connecting": { en: "Connecting to the herd…", fr: "Connexion à la meute…" },
  "boot.notConnected": { en: "Not connected", fr: "Non connecté" },
  "boot.unreachable": {
    en: "Can’t reach Collie — check your connection to the host, then try again.",
    fr: "Collie est injoignable — vérifiez votre connexion à l'hôte, puis réessayez.",
  },
  "error.title": { en: "Something went wrong", fr: "Une erreur est survenue" },
  "error.unknown": { en: "Unknown error", fr: "Erreur inconnue" },
  "error.back": { en: "Go back", fr: "Retour" },
  "update.tapBanner": { en: "New version — tap to update", fr: "Nouvelle version — touchez pour mettre à jour" },
  "toast.dismiss": { en: "Dismiss", fr: "Fermer" },
  "preview.currentAnswer": { en: "Current answer", fr: "Réponse actuelle" },
});
