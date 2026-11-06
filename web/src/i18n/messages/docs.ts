import { defineMessages } from "../define";

// The Documents tab: the repo's Markdown on its default branch, classed by the doc convention.
export const docs = defineMessages({
  "docs.title": { en: "Documents", fr: "Documents" },
  "docs.onRef": { en: "on {ref}", fr: "sur {ref}" },
  "docs.pickRepo": { en: "Pick a project to read its documents.", fr: "Choisissez un projet pour lire ses documents." },
  "docs.search": { en: "Search titles and text", fr: "Rechercher dans les titres et le texte" },
  "docs.decisions": { en: "Decisions", fr: "Décisions" },
  "docs.other": { en: "Other", fr: "Autres" },
  "docs.empty": { en: "No Markdown on {ref}.", fr: "Aucun Markdown sur {ref}." },
  "docs.noMatch": { en: "Nothing matches.", fr: "Rien ne correspond." },
  "docs.back": { en: "All documents", fr: "Tous les documents" },
  "docs.loading": { en: "Loading…", fr: "Chargement…" },
  "docs.loadFailed": { en: "Couldn't read this document on {ref}.", fr: "Impossible de lire ce document sur {ref}." },
  "docs.truncated": { en: "Truncated: the file is too long to show whole.", fr: "Tronqué : le fichier est trop long pour être affiché en entier." },
  "docs.roadmap": { en: "Roadmap", fr: "Roadmap" },
  "docs.status.decided": { en: "✅ Decided", fr: "✅ Décidé" },
  "docs.status.leaning": { en: "🟡 Leaning", fr: "🟡 Piste" },
  "docs.status.open": { en: "❓ Open", fr: "❓ Ouvert" },
});
