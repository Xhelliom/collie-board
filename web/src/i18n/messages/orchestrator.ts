import { defineMessages } from "../define";

// The project's orchestrator panel (ADR 0021, 0023).
export const orchestrator = defineMessages({
  "orch.pickRepo": {
    en: "Pick a repo (the board's repo filter) to talk to its project's orchestrator.",
    fr: "Choisis un dépôt (filtre « repo » du board) pour discuter avec l'orchestrateur de son projet.",
  },
  "orch.started": { en: "Orchestrator started.", fr: "Orchestrateur démarré." },
  "orch.noting": { en: "It is updating its note…", fr: "Il met sa note à jour…" },
  "orch.renewed": { en: "Orchestrator renewed.", fr: "Orchestrateur renouvelé." },
  "orch.intro": {
    en: "An agent dedicated to this project: it reads the board, proposes phases, lots and a roadmap, and prepares it all without ever launching anything. It uses your quota while it works.",
    fr: "Un agent dédié à ce projet : il lit le board, propose des phases, des lots et une roadmap, et prépare le tout sans jamais rien lancer. Il consomme ton quota tant qu'il travaille.",
  },
  "orch.starting": { en: "Starting…", fr: "Démarrage…" },
  "orch.start": { en: "Start the orchestrator", fr: "Démarrer l'orchestrateur" },
  "orch.title": { en: "Orchestrator", fr: "Orchestrateur" },
  "orch.ctxFull": { en: "Context {pct}% full", fr: "Contexte rempli à {pct} %" },
  "orch.fullscreen": { en: "Open full screen", fr: "Ouvrir en plein écran" },
  "orch.handover": {
    en: "The context is filling up — renew the orchestrator. It writes its note, then a new one starts from that note.",
    fr: "Le contexte se remplit — renouvelle l'orchestrateur. Il écrit sa note, puis un nouveau repart de cette note.",
  },
  "orch.askNote": { en: "Ask it to take notes", fr: "Lui demander de noter" },
  "orch.restart": { en: "Start afresh", fr: "Repartir à neuf" },
  "orch.waitingNote": { en: "Waiting for its note…", fr: "En attente de sa note…" },
  "orch.thread": { en: "Orchestrator thread", fr: "Fil de l'orchestrateur" },
  "orch.warmingUp": {
    en: "It is starting… its first reply appears here.",
    fr: "Il démarre… sa première réponse apparaît ici.",
  },
  "orch.memory": { en: "Memory", fr: "Mémoire" },
  "orch.memoryNoted": { en: "Memory · noted {ago}", fr: "Mémoire · notée {ago}" },
  "orch.memoryEmpty": {
    en: "No note yet: it writes one at each milestone, and its successor reads it.",
    fr: "Pas encore de note : il l'écrit à chaque jalon, et c'est elle que lira son successeur.",
  },
  "orch.message": { en: "Message to the orchestrator", fr: "Message à l'orchestrateur" },
  "orch.placeholder": { en: "Tell it what you want to plan…", fr: "Dis-lui ce que tu veux planifier…" },
  "orch.send": { en: "Send", fr: "Envoyer" },
});
