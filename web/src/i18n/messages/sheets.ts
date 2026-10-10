import { defineMessages } from "../define";

// The run sheet and the gate (ADR 0017, 0020): what the operator consents to before a run starts.
export const sheets = defineMessages({
  "gate.control.title": { en: "Gate per repo", fr: "Barrière par dépôt" },
  "gate.control.hint": {
    en: "The command run on each worker's return, before the lead, during a run.",
    fr: "La commande lancée sur chaque retour de worker avant le lead, pendant un run.",
  },
  "gate.none": { en: "none", fr: "aucune" },
  "gate.sheet.title": { en: "Gate · {repo}", fr: "Barrière · {repo}" },
  "gate.remove": { en: "Remove", fr: "Retirer" },
  "gate.save": { en: "Save", fr: "Enregistrer" },
  "gate.intro": {
    en: "The command run in the worker's checkout before the lead. Red: the worker is sent back without asking the lead.",
    fr: "Commande lancée dans le checkout du worker avant le lead. Rouge : le worker est renvoyé sans solliciter le lead.",
  },
  "gate.command": { en: "Command", fr: "Commande" },
  "gate.noShell": {
    en: "No shell: words separated by spaces. To chain steps, use a script.",
    fr: "Pas de shell : des mots séparés par des espaces. Pour enchaîner, un script.",
  },
  "gate.suggest": { en: "Suggest (copilot)", fr: "Suggérer (copilote)" },
  "gate.suggesting": { en: "The copilot is reading the repo…", fr: "Le copilote lit le dépôt…" },
  "gate.suggestion": { en: "Suggestion", fr: "Suggestion" },
  "gate.createYourself": { en: "To create yourself in the repo:", fr: "À créer toi-même dans le dépôt :" },

  "run.title": {
    en: { one: "Run {count} card · {repo}", other: "Run {count} cards · {repo}" },
    fr: { one: "Run de {count} carte · {repo}", other: "Run de {count} cartes · {repo}" },
  },
  "run.launch": { en: "Launch the run", fr: "Lancer le run" },
  "run.plan": { en: "Plan a lot", fr: "Planifier un lot" },
  "run.order": { en: "Order", fr: "Ordre" },
  "run.orderHint": { en: "Order (from the dependencies)", fr: "Ordre (tiré des dépendances)" },
  "run.parallel": { en: "Parallelism", fr: "Parallélisme" },
  "run.parallelBoard": {
    en: { one: "the board allows {count} agent at a time", other: "the board allows {count} agents at a time" },
    fr: { one: "le board autorise {count} agent à la fois", other: "le board autorise {count} agents à la fois" },
  },
  "run.parallelCap": { en: "Cards of this lot at a time", fr: "Cartes à la fois dans ce lot" },
  "run.parallelAuto": { en: "As the board allows", fr: "Selon le board" },
  "run.parallelOne": { en: "One at a time", fr: "Une à la fois" },
  "run.parallelN": { en: "{count} at a time", fr: "{count} à la fois" },
  "run.gate": { en: "Gate", fr: "Barrière" },
  "run.gateNone": { en: "none — the lead judges on the diff alone", fr: "aucune — le lead juge sur le diff seul" },
  "run.gateEdit": { en: "Edit", fr: "Modifier" },
  "run.gateSet": { en: "Set", fr: "Régler" },
  "run.lot": { en: "Lot", fr: "Lot" },
  "run.lotHint": { en: "Lot (to plan instead of launching)", fr: "Lot (pour planifier au lieu de lancer)" },
  "run.lotName": { en: "Lot name", fr: "Nom du lot" },
  "run.lotPhase": { en: "Lot phase", fr: "Phase du lot" },
  "run.noPhase": { en: "No phase", fr: "Sans phase" },
  "run.foldCap": { en: "Fold-in cap", fr: "Plafond de fold-ins" },
  "run.leadAgent": { en: "Lead agent", fr: "Agent du lead" },
});
