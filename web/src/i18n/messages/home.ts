import { defineMessages } from "../define";

// The home dashboard: the herd ring, the board's figures, one tile per repo, the quota rings.
// `**bold**` in a message is rendered bold by `rich()` (lib/project-facts.tsx).
export const home = defineMessages({
  "home.eyebrow": { en: "Herd · live", fr: "Troupeau · en direct" },
  "home.sum.none": { en: "No agent is running.", fr: "Aucun agent en cours." },
  "home.sum.needs": {
    en: { one: "**{count}** agent needs you", other: "**{count}** agents need you" },
    fr: { one: "**{count}** agent attend ta réponse", other: "**{count}** agents attendent ta réponse" },
  },
  "home.sum.calm": { en: "Nothing needs you", fr: "Rien n'attend ta réponse" },
  "home.sum.working": {
    en: { one: "**{count}** is working", other: "**{count}** are working" },
    fr: { one: "**{count}** travaille", other: "**{count}** travaillent" },
  },
  "home.sum.review": {
    en: { one: "**{count}** card to review", other: "**{count}** cards to review" },
    fr: { one: "**{count}** carte à relire", other: "**{count}** cartes à relire" },
  },
  "home.ring.aria": { en: "{needs} need you, {working} working, {idle} idle", fr: "{needs} t'attendent, {working} travaillent, {idle} au repos" },
  "home.ring.agents": { en: "agents", fr: "agents" },
  "home.ring.legend": { en: "{needs} · {working} · {idle}", fr: "{needs} · {working} · {idle}" },
  "home.kpi.review": { en: "To review", fr: "À relire" },
  "home.kpi.stuck": { en: "Stuck", fr: "Bloquées" },
  "home.kpi.ready": { en: "Ready", fr: "Prêtes" },
  "home.kpi.delivered": { en: "Delivered · 7 d", fr: "Livrées · 7 j" },
  "home.kpi.reviewNote": { en: "waiting for your eyes", fr: "attendent ton regard" },
  "home.kpi.stuckNote": { en: "blocked or orphaned", fr: "bloquées ou orphelines" },
  "home.kpi.readyNote": { en: "can start now", fr: "peuvent démarrer" },
  "home.kpi.deliveredNote": { en: "cards done this week", fr: "cartes finies cette semaine" },
  "home.projects": { en: "Projects", fr: "Projets" },
  "home.project.loose": { en: "No phase", fr: "Hors phase" },
  "home.project.idle": {
    en: { one: "Nothing in progress · {count} phase delivered", other: "Nothing in progress · {count} phases delivered" },
    fr: { one: "Rien en cours · {count} phase livrée", other: "Rien en cours · {count} phases livrées" },
  },
  "home.project.flight": { en: "{count} in flight", fr: "{count} en cours" },
  "home.project.waiting": { en: "{count} waiting for you", fr: "{count} t'attendent" },
  "home.usage": { en: "Quota", fr: "Quota" },
  "home.usage.refresh": { en: "Refresh the quota", fr: "Rafraîchir le quota" },
  "home.usage.aria": { en: "{label}: {percent}% used", fr: "{label} : {percent} % utilisé" },
  "home.usage.resets": { en: "resets {when}", fr: "se réinitialise {when}" },
  "home.usage.atLimit": { en: "at the limit", fr: "à la limite" },
  "home.prs": { en: "Open PRs", fr: "PR ouvertes" },
  "home.activity": { en: "Activity", fr: "Activité" },
  "home.activity.empty": { en: "Nothing yet.", fr: "Rien pour l'instant." },
  "home.activity.blocked": { en: "needs you", fr: "a besoin de toi" },
  "home.activity.done": { en: "finished", fr: "a terminé" },
  "home.activity.stalled": { en: "stalled", fr: "est à l'arrêt" },
  "home.activity.ready": { en: "is ready to start", fr: "peut démarrer" },
  "home.activity.note": { en: "note", fr: "note" },
});
