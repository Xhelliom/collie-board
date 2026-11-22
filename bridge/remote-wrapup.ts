// A card run on a peer, filed done or archived (its PR merged, the operator, the end of a lot): its agent
// stayed open on the peer — `cleanupCard` only ever ends local sessions (incident 22/11, Dell). Read off
// the peer herd's own read (peer-herd.ts `onRead`), no loop of its own: at each read, the session of a
// finished card is ended there (`endOnPeer`) once its pane no longer works. A peer that does not answer
// is simply not read, a refusal is tried again at the next read; the first read after a start catches
// up the cards finished before it.

import { endOnPeer, remoteSessionFor, type RemoteDeps } from "./remote-launch.ts";

export class RemoteWrapup {
  constructor(private readonly d: Omit<RemoteDeps, "branchPrefix">) {}

  /** One peer's agents, as just read from a connected peer. Resolves once the ends it started are back. */
  async seen(peer: string, agents: readonly Record<string, unknown>[]): Promise<void> {
    const ends: Promise<unknown>[] = [];
    for (const card of this.d.db.finishedPeerCards()) {
      if (card.environment?.peer !== peer) continue;
      const s = remoteSessionFor(this.d.db, card.id);
      if (!s || s.peer !== peer) continue;
      const status = agents.find((a) => a.paneId === s.paneId)?.status;
      if (status === "working" || status === "blocked") continue;
      // PeerHerd awaits this before its next read of the peer: never the same end twice in flight.
      ends.push(endOnPeer({ ...this.d, branchPrefix: "" }, card).catch(() => null));
    }
    await Promise.all(ends);
  }
}
