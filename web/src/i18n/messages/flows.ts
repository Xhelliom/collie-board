import { defineMessages } from "../define";

// Flows — named pipelines of roles (ADR 0032).
export const flows = defineMessages({
  "flows.title": { en: "Flows", fr: "Flux" },
  "flows.hint": {
    en: "A flow chains roles on one card: implement, then review… Pick it on a repo, a phase or a card; a launched lot runs the steps in order.",
    fr: "Un flux enchaîne des rôles sur une carte : implémenter, puis relire… Choisis-le sur un repo, une phase ou une carte ; un lot lancé exécute les étapes dans l'ordre.",
  },
  "flows.manage": { en: "Manage", fr: "Gérer" },
  "flows.count": {
    en: { one: "{count} flow", other: "{count} flows" },
    fr: { one: "{count} flux", other: "{count} flux" },
  },
  "flows.builtin.code.name": { en: "Code: implement then review", fr: "Code : implémenter puis relire" },
  "flows.builtin.code.description": {
    en: "An implementer writes the change, then a reviewer reads the branch.",
    fr: "Un implémenteur écrit le changement, puis un relecteur lit la branche.",
  },
  "flows.builtin.doc.name": { en: "Doc only", fr: "Doc seule" },
  "flows.builtin.doc.description": { en: "One writer, no review.", fr: "Un rédacteur, sans relecture." },
  "flows.builtin.explore.name": { en: "Exploration", fr: "Exploration" },
  "flows.builtin.explore.description": { en: "One read-only exploration.", fr: "Une exploration en lecture seule." },
  "flows.shipped": { en: "Shipped", fr: "Fourni" },
  "flows.new": { en: "New flow", fr: "Nouveau flux" },
  "flows.edit": { en: "Edit", fr: "Modifier" },
  "flows.reset": { en: "Reset to shipped", fr: "Remettre l'original" },
  "flows.delete": { en: "Delete", fr: "Supprimer" },
  "flows.deleteConfirm": { en: "Tap again to delete", fr: "Touche encore pour supprimer" },
  "flows.back": { en: "Back to the list", fr: "Retour à la liste" },
  "flows.empty": { en: "No flow yet.", fr: "Aucun flux pour l'instant." },
  "flows.field.name": { en: "Name", fr: "Nom" },
  "flows.field.description": { en: "Description", fr: "Description" },
  "flows.field.steps": { en: "Steps, in order", fr: "Étapes, dans l'ordre" },
  "flows.step.add": { en: "Add a step", fr: "Ajouter une étape" },
  "flows.step.remove": { en: "Remove {name}", fr: "Retirer {name}" },
  "flows.step.up": { en: "Move {name} up", fr: "Monter {name}" },
  "flows.step.down": { en: "Move {name} down", fr: "Descendre {name}" },
  "flows.stepsMax": { en: "At most 6 steps.", fr: "6 étapes au plus." },
  "flows.save": { en: "Save", fr: "Enregistrer" },
  "flows.saving": { en: "Saving…", fr: "Enregistrement…" },
  "flows.saved": { en: "Flow saved.", fr: "Flux enregistré." },
  "flows.picker.label": { en: "Flow", fr: "Flux" },
  "flows.picker.none": { en: "No flow", fr: "Aucun flux" },
  "flows.picker.hint": {
    en: "In a launched lot, each step takes the branch after the one before it.",
    fr: "Dans un lot lancé, chaque étape reprend la branche après la précédente.",
  },
  "flows.repo.label": { en: "Default flow", fr: "Flux par défaut" },
  "flows.repo.hint": {
    en: "Used when neither the card nor its phase names a flow or a template.",
    fr: "Utilisé quand ni la carte ni sa phase ne nomment un flux ou un template.",
  },
});
