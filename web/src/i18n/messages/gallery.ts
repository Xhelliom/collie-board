import { defineMessages } from "../define";

// The gallery (scratchpad files), a card session's artifacts, and the document reader they share.
export const gallery = defineMessages({
  "gallery.title": { en: "Gallery", fr: "Galerie" },
  "gallery.images": {
    en: { one: "{count} image", other: "{count} images" },
    fr: { one: "{count} image", other: "{count} images" },
  },
  "gallery.documents": {
    en: { one: "{count} document", other: "{count} documents" },
    fr: { one: "{count} document", other: "{count} documents" },
  },
  "gallery.documentsSuffix": { en: "documents", fr: "documents" },
  "gallery.closeDocument": { en: "Close document", fr: "Fermer le document" },
  "gallery.filterByProject": { en: "Filter by project", fr: "Filtrer par projet" },
  "gallery.all": { en: "All", fr: "Tous" },
  "gallery.empty": {
    en: "Nothing yet. Anything an agent writes into its scratchpad — pictures, pages, reports — shows up here.",
    fr: "Rien pour l'instant. Tout ce qu'un agent écrit dans son bloc-notes — images, pages, rapports — apparaît ici.",
  },
  "gallery.fromScratchpad": { en: "from the scratchpad", fr: "depuis le bloc-notes" },
  "gallery.fromWorktree": { en: "from the worktree", fr: "depuis le worktree" },
  "gallery.kind.image": { en: "Image", fr: "Image" },
  "gallery.kind.markdown": { en: "Markdown", fr: "Markdown" },
  "gallery.kind.html": { en: "HTML", fr: "HTML" },
  "gallery.sandboxedTitle": { en: "{name} (sandboxed)", fr: "{name} (isolé)" },
  "gallery.sandboxedNote": {
    en: "Sandboxed — scripts and external content are disabled.",
    fr: "Isolé — les scripts et le contenu externe sont désactivés.",
  },
  "gallery.loadFailed": { en: "Couldn't load {name} {from}.", fr: "Impossible de charger {name} {from}." },
  "gallery.imageAlt": { en: "image", fr: "image" },

  "artifacts.title": { en: "Artifacts", fr: "Artefacts" },
  "artifacts.subtitle": {
    en: { one: "{count} file in the worktree · {pane}", other: "{count} files in the worktree · {pane}" },
    fr: { one: "{count} fichier dans le worktree · {pane}", other: "{count} fichiers dans le worktree · {pane}" },
  },
  "artifacts.close": { en: "Close artifact", fr: "Fermer l'artefact" },
  "artifacts.empty": {
    en: "No artifacts yet. Images, reports and pages an agent writes into its worktree show up here.",
    fr: "Aucun artefact pour l'instant. Les images, rapports et pages qu'un agent écrit dans son worktree apparaissent ici.",
  },
  "artifacts.backToConversation": { en: "Back to the conversation", fr: "Retour à la conversation" },
  "artifacts.openFullScreen": { en: "Open {name} full-screen", fr: "Ouvrir {name} en plein écran" },
});
