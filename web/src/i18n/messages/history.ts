import { defineMessages } from "../define";

// The pane history screen: header, find bar, transcript.
export const history = defineMessages({
  "history.title": { en: "History", fr: "Historique" },
  "history.more": { en: "More", fr: "Plus" },
  "history.find": { en: "Find in history", fr: "Chercher dans l'historique" },
  "history.close": { en: "Close history", fr: "Fermer l'historique" },
  "history.images": { en: "Images in this session ({count})", fr: "Images de cette session ({count})" },
  "history.artifacts": { en: "Session artifacts", fr: "Artefacts de la session" },
  "history.loading": { en: "Loading…", fr: "Chargement…" },
  "history.loadOlder": { en: "Load older", fr: "Charger plus ancien" },
  "history.loadFailed": { en: "Couldn't load older history", fr: "Impossible de charger l'historique plus ancien" },
  "history.startClipped": {
    en: "Start of the readable transcript (the log was clipped at the read cap)",
    fr: "Début de la transcription lisible (le journal a été coupé à la limite de lecture)",
  },
  "history.start": { en: "Start of the conversation", fr: "Début de la conversation" },
  "history.prevUser": { en: "Previous message you sent", fr: "Message envoyé précédent" },
  "history.nextUser": { en: "Next message you sent", fr: "Message envoyé suivant" },
  "history.unavailable.disabled": {
    en: "Transcript history is switched off on this bridge (COLLIE_BOARD_TRANSCRIPT).",
    fr: "L'historique des transcriptions est désactivé sur ce bridge (COLLIE_BOARD_TRANSCRIPT).",
  },
  "history.unavailable.no-session": {
    en: "This pane has no agent session, so there's no transcript to read.",
    fr: "Ce pane n'a pas de session d'agent, donc pas de transcription à lire.",
  },
  "history.unavailable.no-log": {
    en: "No transcript file was found for this pane's session yet.",
    fr: "Aucun fichier de transcription trouvé pour la session de ce pane pour l'instant.",
  },
  "history.unavailable.unsupported": {
    en: "This agent keeps no transcript Collie can read, so there's no history to show.",
    fr: "Cet agent ne garde aucune transcription que Collie puisse lire, donc pas d'historique à afficher.",
  },
  "history.unavailable.error": {
    en: "Couldn't read the transcript. Pull back and try again.",
    fr: "Impossible de lire la transcription. Reviens en arrière et réessaie.",
  },
  "find.placeholder.history": { en: "Find in history…", fr: "Chercher dans l'historique…" },
  "find.placeholder.output": { en: "Find in output…", fr: "Chercher dans la sortie…" },
  "find.label.history": { en: "Find in history", fr: "Chercher dans l'historique" },
  "find.label.output": { en: "Find in output", fr: "Chercher dans la sortie" },
  "find.prev": { en: "Previous match", fr: "Résultat précédent" },
  "find.next": { en: "Next match", fr: "Résultat suivant" },
  "find.close": { en: "Close find", fr: "Fermer la recherche" },
  "transcript.more": { en: "Show all", fr: "Voir tout" },
  "transcript.less": { en: "Show less", fr: "Voir moins" },
  "transcript.outputTruncated": { en: "… output truncated", fr: "… sortie tronquée" },
  "transcript.thinking": { en: "Thinking", fr: "Réflexion" },
  "transcript.truncated": { en: "… truncated", fr: "… tronqué" },
  "transcript.compacted": { en: "Context compacted", fr: "Contexte compacté" },
  "transcript.system": { en: "System", fr: "Système" },
  "transcript.you": { en: "You", fr: "Toi" },
  "transcript.steps": { en: "{count} steps", fr: "{count} étapes" },
});
