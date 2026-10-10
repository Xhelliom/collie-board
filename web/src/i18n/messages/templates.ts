import { defineMessages } from "../define";

// Agent templates (ADR 0026).
export const templates = defineMessages({
  "templates.title": { en: "Agent templates", fr: "Templates d'agent" },
  "templates.hint": {
    en: "Roles for your workers: a brief, an agent and a model, applied when a card starts.",
    fr: "Des rôles pour tes workers : un brief, un agent et un modèle, appliqués au démarrage d'une carte.",
  },
  "templates.manage": { en: "Manage", fr: "Gérer" },
  "templates.count": {
    en: { one: "{count} template", other: "{count} templates" },
    fr: { one: "{count} template", other: "{count} templates" },
  },
  "templates.builtin.implementer.name": { en: "Implementer", fr: "Implémenteur" },
  "templates.builtin.implementer.description": {
    en: "Implements exactly one ticket, tests first, until the checks are green.",
    fr: "Implémente un seul ticket, tests d'abord, jusqu'à ce que les contrôles passent.",
  },
  "templates.builtin.reviewer.name": { en: "Reviewer", fr: "Relecteur" },
  "templates.builtin.reviewer.description": {
    en: "Read-only review of a diff: APPROVE or CHANGES with a short, actionable list.",
    fr: "Relecture d'un diff en lecture seule : APPROVE ou CHANGES, avec une liste courte et actionnable.",
  },
  "templates.builtin.doc.name": { en: "Documentation", fr: "Documentation" },
  "templates.builtin.doc.description": {
    en: "Touches documentation only: no code, no tests, no config.",
    fr: "Ne touche qu'à la documentation : ni code, ni tests, ni configuration.",
  },
  "templates.builtin.explore.name": { en: "Exploration", fr: "Exploration" },
  "templates.builtin.explore.description": {
    en: "Brainstorm or investigation: delivers a written conclusion and the cards it proposes.",
    fr: "Brainstorm ou investigation : livre une conclusion écrite et les cartes qu'elle propose.",
  },
  "templates.builtin.fix.name": { en: "Bug fix", fr: "Correctif" },
  "templates.builtin.fix.description": {
    en: "Finds the root cause, proves it with a failing test, fixes it where all callers route through.",
    fr: "Trouve la cause racine, la prouve par un test qui échoue, corrige là où tous les appelants passent.",
  },
  "templates.shipped": { en: "Shipped", fr: "Fourni" },
  "templates.new": { en: "New template", fr: "Nouveau template" },
  "templates.import": { en: "Import from a repo", fr: "Importer depuis un dépôt" },
  "templates.edit": { en: "Edit", fr: "Modifier" },
  "templates.reset": { en: "Reset to shipped", fr: "Remettre l'original" },
  "templates.delete": { en: "Delete", fr: "Supprimer" },
  "templates.deleteConfirm": { en: "Tap again to delete", fr: "Touche encore pour supprimer" },
  "templates.back": { en: "Back to the list", fr: "Retour à la liste" },
  "templates.agentDefault": { en: "board default", fr: "défaut du board" },
  "templates.empty": { en: "No template yet.", fr: "Aucun template pour l'instant." },
  "templates.field.name": { en: "Name", fr: "Nom" },
  "templates.field.description": { en: "Description", fr: "Description" },
  "templates.field.agent": { en: "Agent", fr: "Agent" },
  "templates.field.model": { en: "Model", fr: "Modèle" },
  "templates.field.brief": { en: "Brief", fr: "Brief" },
  "templates.briefHint": {
    en: "What the agent reads before the card: method, limits, shape of the report.",
    fr: "Ce que l'agent lit avant la carte : méthode, limites, forme du rapport.",
  },
  "templates.modelOnly": {
    en: "The model is only passed to {kinds}; any other agent ignores it.",
    fr: "Le modèle n'est transmis qu'à {kinds} ; les autres agents l'ignorent.",
  },
  "templates.modelInvalid": {
    en: "A model is a single word (sonnet, opus…), never an option.",
    fr: "Un modèle est un seul mot (sonnet, opus…), jamais une option.",
  },
  "templates.draft.title": { en: "Draft with the copilot", fr: "Rédiger avec le copilote" },
  "templates.draft.placeholder": {
    en: "Describe the role… e.g. a reviewer that only looks at authentication",
    fr: "Décris le rôle… par ex. un relecteur qui ne regarde que l'authentification",
  },
  "templates.draft.field": { en: "Describe the role", fr: "Décris le rôle" },
  "templates.draft.go": { en: "Draft with AI", fr: "Rédiger avec l'IA" },
  "templates.draft.busy": { en: "Drafting…", fr: "Rédaction…" },
  "templates.draft.done": {
    en: "Drafted — read it, change what you want, then save.",
    fr: "Rédigé — relis, modifie ce que tu veux, puis enregistre.",
  },
  "templates.draft.failed": { en: "The copilot could not draft it: {error}", fr: "Le copilote n'a pas pu le rédiger : {error}" },
  "templates.save": { en: "Save", fr: "Enregistrer" },
  "templates.saving": { en: "Saving…", fr: "Enregistrement…" },
  "templates.saved": { en: "Template saved.", fr: "Template enregistré." },
  "templates.import.repo": { en: "Repository", fr: "Dépôt" },
  "templates.import.search": { en: "Look for agent files", fr: "Chercher des fichiers d'agent" },
  "templates.import.none": {
    en: "No usable agent file in .claude/agents of this repository.",
    fr: "Aucun fichier d'agent utilisable dans .claude/agents de ce dépôt.",
  },
  "templates.import.found": {
    en: { one: "{count} agent file found — nothing is saved until you choose.", other: "{count} agent files found — nothing is saved until you choose." },
    fr: { one: "{count} fichier d'agent trouvé — rien n'est enregistré tant que tu ne choisis pas.", other: "{count} fichiers d'agent trouvés — rien n'est enregistré tant que tu ne choisis pas." },
  },
  "templates.import.tools": { en: "tools: {tools} (not applied)", fr: "outils : {tools} (non appliqués)" },
  "templates.import.save": {
    en: { one: "Save {count} selected", other: "Save {count} selected" },
    fr: { one: "Enregistrer {count} sélectionné", other: "Enregistrer {count} sélectionnés" },
  },
  "templates.import.saved": {
    en: { one: "{count} template imported.", other: "{count} templates imported." },
    fr: { one: "{count} template importé.", other: "{count} templates importés." },
  },
  "templates.picker.label": { en: "Template", fr: "Template" },
  "templates.picker.none": { en: "None", fr: "Aucun" },
  "templates.picker.runs": { en: "Runs on {kind}, model {model}.", fr: "Tourne sur {kind}, modèle {model}." },
  "templates.picker.runsKind": { en: "Runs on {kind}.", fr: "Tourne sur {kind}." },
  "templates.picker.modelIgnored": { en: "{kind} ignores the model.", fr: "{kind} ignore le modèle." },
  "templates.picker.inherit": {
    en: "Applied when the card starts; the card's own agent wins over the template's.",
    fr: "Appliqué au démarrage de la carte ; l'agent choisi sur la carte l'emporte sur celui du template.",
  },
  "journal.template": { en: "Started with the “{name}” template", fr: "Démarrée avec le template « {name} »" },
});
