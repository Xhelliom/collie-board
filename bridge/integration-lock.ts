// One integration gesture at a time per card. A PR runs `git push` and with it the repo's pre-push hook,
// inside the request: the phone gives up after its own budget, says "still running", and lets the
// operator tap again while the first push is still going — two pushes, or two local merges in the main
// checkout, on one card. The second tap is answered "already running" instead.
//
// In memory on purpose: what it guards is a request in flight, which a restart ends anyway.

/** The cards with an integration gesture in flight. Module-wide: every route shares it. */
export const integrating = new Set<string>();

/** Run `fn` holding `cardId` in `held`, or answer `busy` when it is already held. Released whatever `fn` does. */
export async function exclusive<T>(held: Set<string>, cardId: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  if (held.has(cardId)) return { busy: true };
  held.add(cardId);
  try {
    return { busy: false, value: await fn() };
  } finally {
    held.delete(cardId);
  }
}
