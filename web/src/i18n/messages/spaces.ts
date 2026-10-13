import { defineMessages } from "../define";

// Spaces, the space page, the pane list and the sheets of a space / tab / pane (renamed or closed).
export const spaces = defineMessages({
  "spaces.title": { en: "Spaces", fr: "Spaces" },
  "spaces.space": { en: "Space", fr: "Space" },
  "spaces.closed": { en: "Space closed", fr: "Space fermé" },
  "spaces.notFound": { en: "Space not found", fr: "Space introuvable" },
  "spaces.none": { en: "No spaces yet.", fr: "Aucun space pour l'instant." },
  "spaces.new": { en: "New space", fr: "Nouveau space" },
  "spaces.back": { en: "Back", fr: "Retour" },
  "spaces.all": { en: "All", fr: "Tous" },
  "spaces.tab": { en: "Tab", fr: "Onglet" },
  "spaces.tabTitle": { en: "Tab {label}", fr: "Onglet {label}" },
  "spaces.tabs": { en: "Tabs", fr: "Onglets" },
  "spaces.newTab": { en: "New tab", fr: "Nouvel onglet" },
  "spaces.dismiss": { en: "Dismiss", fr: "Fermer" },
  "spaces.emptyTab": { en: "(empty tab)", fr: "(onglet vide)" },
  "spaces.noPanesTab": { en: "This tab has no panes.", fr: "Cet onglet n'a pas de panes." },
  "spaces.noPanesSpace": { en: "This space has no panes.", fr: "Ce space n'a pas de panes." },
  "spaces.counts": {
    en: { one: "{count} tab", other: "{count} tabs" },
    fr: { one: "{count} onglet", other: "{count} onglets" },
  },
  "spaces.paneCounts": {
    en: { one: "{count} pane", other: "{count} panes" },
    fr: { one: "{count} pane", other: "{count} panes" },
  },
  "spaces.panes": { en: "Panes", fr: "Panes" },
  "spaces.needingYou": { en: "needing you", fr: "à traiter" },
  "spaces.paneActionsHint": { en: "Tap for pane actions", fr: "Toucher pour les actions du pane" },
  "spaces.paneMenu": { en: "Pane {label}. Switch pane in this space", fr: "Pane {label}. Changer de pane dans ce space" },

  "spaces.newSheet.dir": { en: "Directory (optional)", fr: "Dossier (facultatif)" },
  "spaces.newSheet.dirPlaceholder": { en: "~ (home dir)", fr: "~ (dossier personnel)" },
  "spaces.newSheet.label": { en: "Label (optional)", fr: "Nom (facultatif)" },
  "spaces.newSheet.labelPlaceholder": { en: "name this space", fr: "nommer ce space" },
  "spaces.newSheet.create": { en: "Create space & open shell", fr: "Créer le space et ouvrir un shell" },

  "spaces.sessions": { en: "Sessions", fr: "Sessions" },
  "spaces.session.trigger": { en: "Session: {name}. Switch session", fr: "Session : {name}. Changer de session" },
  "spaces.session.default": { en: "default", fr: "par défaut" },
  "spaces.session.primary": { en: "primary", fr: "principale" },
  "spaces.session.unreachable": { en: "unreachable", fr: "injoignable" },
  "spaces.session.needsYou": { en: "{count} needs you", fr: "{count} à traiter" },
  "spaces.session.working": { en: "{count} working", fr: "{count} en cours" },

  "spaces.readOnly.title": { en: "Read-only", fr: "Lecture seule" },
  "spaces.readOnly.body": {
    en: "This device isn't on the allowlist: reading works, writing doesn't.",
    fr: "Cet appareil n'est pas sur l'allowlist : la lecture passe, aucune écriture.",
  },

  "spaces.sheet.rename": { en: "Rename", fr: "Renommer" },
  "spaces.sheet.renamed": { en: "Renamed", fr: "Renommé" },
  "spaces.sheet.labelCleared": { en: "Label cleared", fr: "Nom effacé" },
  "spaces.sheet.renameFailed": { en: "Rename failed", fr: "Échec du renommage" },
  "spaces.sheet.closeFailed": { en: "Close failed", fr: "Échec de la fermeture" },
  "spaces.sheet.closing": { en: "Closing…", fr: "Fermeture…" },
  "spaces.sheet.tapToClose": { en: "Tap again to close", fr: "Toucher à nouveau pour fermer" },
  "spaces.pane.title": { en: "Pane", fr: "Pane" },
  "spaces.pane.close": { en: "Close pane", fr: "Fermer le pane" },
  "spaces.pane.placeholder": { en: "name this pane", fr: "nommer ce pane" },
  "spaces.pane.readOnly": {
    en: "Read-only — this device isn't authorised to rename or close panes.",
    fr: "Lecture seule — cet appareil n'est pas autorisé à renommer ou fermer des panes.",
  },
  "spaces.tab.close": { en: "Close tab", fr: "Fermer l'onglet" },
  "spaces.tab.placeholder": { en: "name this tab", fr: "nommer cet onglet" },
  "spaces.tab.readOnly": {
    en: "Read-only — this device isn't authorised to rename or close tabs.",
    fr: "Lecture seule — cet appareil n'est pas autorisé à renommer ou fermer des onglets.",
  },
  "spaces.tab.tapToClosePanes": {
    en: { one: "Tap again to close {count} pane", other: "Tap again to close {count} panes" },
    fr: { one: "Toucher à nouveau pour fermer {count} pane", other: "Toucher à nouveau pour fermer {count} panes" },
  },
});
