import { defineMessages } from "../define";

// Words the whole board shares. Area-specific text lives in its own file.
export const common = defineMessages({
  "common.cards": {
    en: { one: "{count} card", other: "{count} cards" },
    fr: { one: "{count} carte", other: "{count} cartes" },
  },
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
