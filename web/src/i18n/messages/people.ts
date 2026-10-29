import { defineMessages } from "../define";

// Who is who on a shared board (ADR 0048 §5) — the tile, the card page, the editor and the filters.
export const people = defineMessages({
  "people.me": { en: "me", fr: "moi" },
  "people.by": { en: "by {name}", fr: "par {name}" },
  "people.to": { en: "to {name}", fr: "à {name}" },
  "people.assignee": { en: "Assignee", fr: "Assignée à" },
  "people.nobody": { en: "Nobody", fr: "Personne" },
  "people.filter": { en: "Who", fr: "Qui" },
  "people.everyone": { en: "Everyone", fr: "Tout le monde" },
  "people.toMe": { en: "To me", fr: "À moi" },
  "people.runningAt": { en: "running at {name}'s", fr: "en cours chez {name}" },
});
