import { defineMessages } from "../define";

// Words the whole board shares. Area-specific text lives in its own file.
export const common = defineMessages({
  "common.loading": { en: "Loading…", fr: "Chargement…" },
  "common.cards": {
    en: { one: "{count} card", other: "{count} cards" },
    fr: { one: "{count} carte", other: "{count} cartes" },
  },
  "fold.more": {
    en: { one: "Show {count} more", other: "Show {count} more" },
    fr: { one: "Voir {count} autre", other: "Voir les {count} autres" },
  },
  "common.back": { en: "Back", fr: "Retour" },
  "common.close": { en: "Close", fr: "Fermer" },
  "common.saved": { en: "Saved ✓", fr: "Enregistré ✓" },
  "error.saveFailed": { en: "Setting not saved: {error}", fr: "Réglage non enregistré : {error}" },
  "lightbox.label": { en: "Image viewer", fr: "Visionneuse d'images" },
  "notifications.title": { en: "Notifications", fr: "Notifications" },
  "notifications.titleCount": { en: "Notifications ({count})", fr: "Notifications ({count})" },
  "notifications.failed": { en: "Couldn't read the history.", fr: "Impossible de lire l'historique." },
  "notifications.empty": {
    en: "Nothing has pinged yet. Alerts land here as they fire — including the ones you slept through.",
    fr: "Rien n'a encore sonné. Les alertes arrivent ici au fil de l'eau — y compris celles que tu as dormies.",
  },
  "fold.less": { en: "Show less", fr: "Voir moins" },
  // A card's column. Lane names below must repeat a column's name only on the lane's FIRST column
  // (lib/board.test.ts), so "Actives" is not "En cours".
  "status.blocked": { en: "Needs you", fr: "À toi" },
  "status.review": { en: "To review", fr: "À relire" },
  "status.working": { en: "In progress", fr: "En cours" },
  "status.starting": { en: "Starting", fr: "Démarrage" },
  "status.orphaned": { en: "Orphaned", fr: "Orpheline" },
  "status.ready": { en: "Ready", fr: "Prête" },
  "status.backlog": { en: "Backlog", fr: "Backlog" },
  "status.done": { en: "Done", fr: "Terminée" },
  "status.archived": { en: "Archived", fr: "Archivée" },
  "lane.todo": { en: "To do", fr: "À faire" },
  "lane.doing": { en: "Doing", fr: "Actives" },
  "lane.review": { en: "To review", fr: "À relire" },
  "lane.done": { en: "Done", fr: "Terminée" },
});
