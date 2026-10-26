import { defineMessages } from "../define";

// Settings → Peers: pairing two Collies by code (ADR 0049).
export const peers = defineMessages({
  "settings.tab.peers": { en: "Peers", fr: "Pairs" },
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
  "peers.test.refused": { en: "Token refused (401)", fr: "Jeton refusé (401)" },
  "peers.test.closed": { en: "Surface closed (404)", fr: "Surface fermée (404)" },
  "peers.test.unreachable": { en: "Unreachable: {error}", fr: "Injoignable : {error}" },
});
