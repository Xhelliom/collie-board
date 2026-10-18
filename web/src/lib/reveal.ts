// Scroll to a section that may not be there yet: the route is still loading, the block is waiting on
// its own fetch, or a sheet is still closing (its focus return would scroll the page back). Waits for
// the element AND for no Vaul drawer to be left in the DOM, then calls `found`; past `timeoutMs`,
// calls `missing` so the caller can say so instead of doing nothing. Returns the cleanup.
export function revealWhenRendered(id: string, found: (el: HTMLElement) => void, missing: () => void, timeoutMs = 5000): () => void {
  let done = false;
  const ready = () => {
    const el = document.getElementById(id);
    return el && !document.querySelector("[data-vaul-drawer]") ? el : null;
  };
  const finish = (el: HTMLElement | null) => {
    done = true;
    obs.disconnect();
    clearTimeout(timer);
    if (el) found(el);
    else missing();
  };
  const obs = new MutationObserver(() => {
    const el = ready();
    if (el && !done) finish(el);
  });
  const timer = setTimeout(() => !done && finish(ready()), timeoutMs);
  const now = ready();
  if (now) finish(now);
  else obs.observe(document.body, { childList: true, subtree: true });
  return () => {
    done = true;
    obs.disconnect();
    clearTimeout(timer);
  };
}
