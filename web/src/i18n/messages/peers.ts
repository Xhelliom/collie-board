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
  "cardEnv.unreachableOption": { en: "{peer} — unreachable: {error}", fr: "{peer} — injoignable : {error}" },
  "cardEnv.on": { en: "on {peer}", fr: "sur {peer}" },
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

  "peers.env.title": { en: "Environments offered", fr: "Environnements offerts" },
  "peers.env.hint": {
    en: "Where a peer may run an agent here: a repo the board knows and an agent. A peer only ever sees the name.",
    fr: "Où un pair peut faire tourner un agent ici : un dépôt connu du board et un agent. Un pair n'en voit que le nom.",
  },
  "peers.env.name": { en: "Name", fr: "Nom" },
  "peers.env.repo": { en: "Repository", fr: "Dépôt" },
  "peers.env.agent": { en: "Agent", fr: "Agent" },
  "peers.env.pickRepo": { en: "Choose a repository", fr: "Choisir un dépôt" },
  "peers.env.add": { en: "Declare", fr: "Déclarer" },
  "peers.env.rename": { en: "Rename", fr: "Renommer" },
  "peers.env.save": { en: "Save", fr: "Enregistrer" },
  "peers.env.cancel": { en: "Cancel", fr: "Annuler" },
  "peers.env.remove": { en: "Remove", fr: "Retirer" },
});
