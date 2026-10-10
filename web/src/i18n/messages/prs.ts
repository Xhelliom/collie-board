import { defineMessages } from "../define";

// The Open PRs screen (ADR 0014): what the journal says is still open, and what GitHub said on a check.
export const prs = defineMessages({
  "prs.title": { en: "Open PRs", fr: "PR ouvertes" },
  "prs.count": { en: { one: "{count} PR", other: "{count} PRs" }, fr: { one: "{count} PR", other: "{count} PR" } },
  "prs.checkedAgo": { en: " · checked {ago}", fr: " · vérifiées {ago}" },
  "prs.check": { en: "Check", fr: "Vérifier" },
  "prs.checking": { en: "Checking…", fr: "Vérification…" },
  "prs.empty": {
    en: "No open PRs. A card lands here when “Open a PR” succeeds, and leaves once a check sees its PR merged or closed.",
    fr: "Aucune PR ouverte. Une carte arrive ici quand « Ouvrir une PR » réussit, et part dès qu'une vérification voit sa PR fusionnée ou fermée.",
  },
  "prs.unchecked": {
    en: "Nothing has asked GitHub yet — tap Check to see which ones still merge.",
    fr: "Personne n'a encore interrogé GitHub — touche Vérifier pour voir lesquelles fusionnent encore.",
  },
  "prs.chip.conflict": { en: "Conflicts with its base", fr: "En conflit avec sa base" },
  "prs.chip.mergeable": { en: "Mergeable", fr: "Fusionnable" },
  "prs.chip.pending": { en: "GitHub is still working it out", fr: "GitHub n'a pas encore tranché" },
  "prs.chip.unknown": { en: "GitHub could not be asked", fr: "GitHub n'a pas pu être interrogé" },
  "prs.sum.conflict": {
    en: { one: "{count} conflict", other: "{count} conflicts" },
    fr: { one: "{count} conflit", other: "{count} conflits" },
  },
  "prs.sum.mergeable": {
    en: { one: "{count} mergeable", other: "{count} mergeable" },
    fr: { one: "{count} fusionnable", other: "{count} fusionnables" },
  },
  "prs.sum.pending": { en: "{count} GitHub hasn't worked out yet", fr: "{count} pas encore tranchées par GitHub" },
  "prs.sum.unknown": { en: "{count} GitHub could not be asked about", fr: "{count} sans réponse de GitHub" },
  "prs.sum.retry": { en: " — check again in a few seconds.", fr: " — revérifie dans quelques secondes." },
  "prs.opened": { en: "opened {ago}", fr: "ouverte {ago}" },
  "prs.auto.armed": {
    en: "Auto-merge armed — GitHub merges it once its checks pass.",
    fr: "Auto-merge armé — GitHub la fusionne dès que ses vérifications passent.",
  },
  "prs.auto.refused": {
    en: "GitHub would not merge this by itself — turn on “Allow auto-merge” for the repo, or merge it yourself.",
    fr: "GitHub ne la fusionnera pas tout seul — active « Allow auto-merge » sur le dépôt, ou fusionne-la toi-même.",
  },
  "prs.reopen": { en: "Reopen with an agent", fr: "Rouvrir avec un agent" },
  "prs.reopening": { en: "Starting an agent…", fr: "Démarrage d'un agent…" },
  "prs.reopened": {
    en: "Sent to the agent — tap Update the PR on the card once it has committed.",
    fr: "Envoyé à l'agent — touche « Mettre à jour la PR » sur la carte quand il aura commité.",
  },
  "prs.over": { en: "Merged or closed — leaving this list", fr: "Fusionnées ou fermées — elles quittent cette liste" },
  "prs.merged": { en: "merged {ago}", fr: "fusionnée {ago}" },
  "prs.closed": { en: "closed without merging", fr: "fermée sans fusion" },
});
