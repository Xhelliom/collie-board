import { defineMessages } from "../define";

// Settings → Peers: pairing two Collies by code (ADR 0049).
export const peers = defineMessages({
  "settings.tab.peers": { en: "Peers", fr: "Pairs" },

  // The header's machine switcher: this machine and the ones it drives.
  "machines.label": { en: "Machine: {name} — switch", fr: "Machine : {name} — changer" },
  "machines.title": { en: "Machines", fr: "Machines" },
  "machines.this": { en: "this machine", fr: "cette machine" },
  "machines.up": { en: "reachable", fr: "joignable" },
  "machines.down": { en: "unreachable", fr: "injoignable" },
  "machines.pending": { en: "checking…", fr: "vérification…" },
  // The herd list: a paired peer whose agents can't be read (ADR 0048's one herd).
  "herd.peerDown": { en: "{peer} — unreachable", fr: "{peer} — injoignable" },

  // The card screen: where a card runs (ADR 0046 §4).
  "cardEnv.label": { en: "Launch on", fr: "Lancer sur" },
  "cardEnv.local": { en: "This machine", fr: "Cette machine" },
  "cardEnv.option": { en: "{name} · {peer}", fr: "{name} · {peer}" },
  "cardEnv.deniedOption": { en: "{name} · {peer} — launch not granted by {peer}", fr: "{name} · {peer} — lancement non accordé par {peer}" },
  "cardEnv.unreachableOption": { en: "{peer} — unreachable: {error}", fr: "{peer} — injoignable : {error}" },
  "cardEnv.on": { en: "on {peer}", fr: "sur {peer}" },
  "cardEnv.engine.hc": { en: "hc", fr: "hc" },
  "cardEnv.engine.herdr09": { en: "0.9", fr: "0.9" },
  "cardEnv.launchFallback": {
    en: "herdr-core (hc) is not answering: this launch will run under herdr 0.9.",
    fr: "herdr-core (hc) ne répond pas : ce lancement se fera sous herdr 0.9.",
  },
  "cardEnv.hint": {
    en: "Only the peers' environments whose origin is this repo's. Started there, never here instead.",
    fr: "Seuls les environnements des pairs dont l'origine est ce dépôt. Lancée là-bas, jamais ici à la place.",
  },
  "cardEnv.locked": {
    en: "A session is running: end it before changing where this card runs.",
    fr: "Une session tourne : terminez-la avant de changer où cette carte s'exécute.",
  },
  "cardEnv.runningOn": { en: "Running on {peer} ({environment}), branch {branch}", fr: "En cours sur {peer} ({environment}), branche {branch}" },
  "cardEnv.pane": { en: "Its agent, when this card was opened: {status}", fr: "Son agent, à l'ouverture de la carte : {status}" },
  "cardEnv.paneGone": { en: "Its pane is no longer there on the peer.", fr: "Son pane n'existe plus chez le pair." },
  "cardEnv.unreachable": { en: "Peer not reached: {error}", fr: "Pair injoignable : {error}" },
  "cardEnv.end": { en: "End the session on {peer}", fr: "Terminer la session sur {peer}" },
  "peers.title": { en: "Peers", fr: "Pairs" },
  "peers.hint": {
    en: "Pair this Collie ({name}) with another one by a code. The token never reaches this browser.",
    fr: "Appairer ce Collie ({name}) avec un autre par un code. Le jeton n'arrive jamais dans ce navigateur.",
  },
  "peers.rewrite": {
    en: "These screens rewrite node.toml and peers.toml: comments written by hand are not kept.",
    fr: "Ces écrans réécrivent node.toml et peers.toml : les commentaires écrits à la main ne sont pas conservés.",
  },

  "peers.invite.title": { en: "Invite a peer", fr: "Inviter un pair" },
  "peers.invite.hint": {
    en: "Lets another machine drive this one: type the code there, in “Add a peer”. Single use, 10 minutes.",
    fr: "Laisse une autre machine piloter celle-ci : tapez le code là-bas, dans « Ajouter un pair ». Usage unique, 10 minutes.",
  },
  "peers.invite.open": { en: "Invite a peer", fr: "Inviter un pair" },
  "peers.invite.cancel": { en: "Cancel", fr: "Annuler" },
  "peers.invite.left": { en: "Expires in {time}", fr: "Expire dans {time}" },
  "peers.invite.burned": {
    en: "Invitation burned by a wrong attempt — {who} at {time}. Invite again.",
    fr: "Invitation brûlée par un essai invalide — {who} à {time}. Réinvitez.",
  },
  "peers.invite.used": { en: "{name} is paired.", fr: "{name} est appairé." },

  "peers.add.title": { en: "Add a peer", fr: "Ajouter un pair" },
  "peers.add.hint": {
    en: "Drive another machine: its address and the code it shows under “Invite a peer”.",
    fr: "Piloter une autre machine : son adresse et le code qu'elle affiche sous « Inviter un pair ».",
  },
  "peers.add.url": { en: "Address of the other Collie", fr: "Adresse de l'autre Collie" },
  "peers.add.urlPlaceholder": { en: "https://machine.tailnet.ts.net", fr: "https://machine.tailnet.ts.net" },
  "peers.add.code": { en: "Code", fr: "Code" },
  "peers.add.codePlaceholder": { en: "XXXX-XXXX", fr: "XXXX-XXXX" },
  "peers.add.submit": { en: "Pair", fr: "Appairer" },
  "peers.add.done": { en: "Paired with {name}.", fr: "Appairé avec {name}." },
  "peers.add.reciprocal": { en: "Let {name} drive this machine too?", fr: "Laisser {name} piloter cette machine aussi ?" },

  "peers.inbound.title": { en: "Who drives this machine", fr: "Qui pilote cette machine" },
  "peers.outbound.title": { en: "Machines this one drives", fr: "Machines que celle-ci pilote" },
  "peers.none": { en: "None yet.", fr: "Aucun pour l'instant." },
  "peers.noLogin": { en: "no Tailscale identity", fr: "aucune identité Tailscale" },
  "peers.unknownLogin": { en: "someone without a Tailscale identity", fr: "quelqu'un sans identité Tailscale" },
  "peers.pairedAt": { en: "paired {date}", fr: "appairé le {date}" },
  "peers.launch.none": { en: "may not launch an agent", fr: "ne peut lancer aucun agent" },
  "peers.launch.all": { en: "may launch in every environment", fr: "peut lancer dans tous les environnements" },
  "peers.launch.some": { en: "may launch in: {envs}", fr: "peut lancer dans : {envs}" },
  "peers.revoke": { en: "Revoke", fr: "Révoquer" },
  "peers.forget": { en: "Forget", fr: "Oublier" },
  "peers.confirm": { en: "Tap again", fr: "Touchez encore" },
  "peers.test": { en: "Test the connection", fr: "Tester la connexion" },
  "peers.test.ok": { en: "Reached — {node} offers {count} environment(s)", fr: "Joint — {node} offre {count} environnement(s)" },
  "peers.test.version": { en: "version {version}", fr: "version {version}" },
  "peers.test.panes": { en: "{count} pane(s)", fr: "{count} pane(s)" },
  "peers.test.herdrDown": { en: "its herdr is disconnected", fr: "son herdr est déconnecté" },
  "peers.test.seenAs": { en: "sees this machine as {peer} ({login})", fr: "voit cette machine comme {peer} ({login})" },
  "peers.test.refused": {
    en: "Token refused (401): the other machine revoked this pairing, or its Tailscale login changed. Pair again.",
    fr: "Jeton refusé (401) : l'autre machine a révoqué cet appairage, ou son identité Tailscale a changé. Réappairez.",
  },
  "peers.test.closed": {
    en: "Nothing there (404): that Collie declares no peer — no invitation accepted, or its node.toml is missing or unreadable.",
    fr: "Rien là-bas (404) : ce Collie ne déclare aucun pair — aucune invitation acceptée, ou son node.toml est absent ou illisible.",
  },
  "peers.test.unreachable": { en: "Unreachable: {error}", fr: "Injoignable : {error}" },

  "repoOffer.title": { en: "Run from another machine", fr: "Exécution depuis un autre poste" },
  "repoOffer.toggle": { en: "Offer this repo to the other machines", fr: "Offrir ce dépôt aux autres postes" },
  "repoOffer.hint": {
    en: "A paired machine may then run an agent here, in this repo — only if you allow it below.",
    fr: "Un poste appairé peut alors faire tourner un agent ici, dans ce dépôt — seulement si vous l'autorisez ci-dessous.",
  },
  "repoOffer.name": { en: "Environment name (what the other machines see)", fr: "Nom d'environnement (ce que voient les autres postes)" },
  "repoOffer.allow": { en: "Allow launching from {peer}", fr: "Autoriser le lancement depuis {peer}" },
  "repoOffer.noPeer": { en: "No paired machine yet — pair one in Settings → Peers.", fr: "Aucun poste appairé — en appairer un dans Réglages → Pairs." },
  "peers.env.summaryHint": {
    en: "Each repo is offered, and its launch rights set, in that project's settings.",
    fr: "Chaque dépôt s'offre, et ses droits de lancement se règlent, dans les réglages de son projet.",
  },
  "peers.env.allowed": { en: "allowed: {peers}", fr: "autorisés : {peers}" },
  "peers.env.nobody": { en: "no machine allowed", fr: "aucun poste autorisé" },
  "peers.env.open": { en: "Project settings", fr: "Réglages du projet" },
  "peers.env.title": { en: "Environments offered", fr: "Environnements offerts" },
  "peers.env.agent": { en: "Agent", fr: "Agent" },
  "peers.env.save": { en: "Save", fr: "Enregistrer" },
  "cardEnv.blocked.no-environment": { en: "{peer} — offers no environment (declare one in its Settings → Peers)", fr: "{peer} — n'offre aucun environnement (en déclarer un dans ses Réglages → Pairs)" },
  "cardEnv.blocked.origin-mismatch": { en: "{peer} — no environment with this repo's origin", fr: "{peer} — aucun environnement avec l'origine de ce dépôt" },
  "cardEnv.blocked.launch-not-granted": { en: "{peer} — launch not granted to this machine (Allow, on {peer})", fr: "{peer} — lancement non accordé à cette machine (Autoriser, sur {peer})" },
});
