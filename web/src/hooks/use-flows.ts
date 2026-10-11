import { useCallback, useEffect, useState } from "react";

import { fetchFlows, type Flow } from "@/lib/flows";

/** The flows, loaded once per mount and again on `reload`. Null until the bridge answers (or never, on an older bridge). */
export function useFlows(): { flows: Flow[] | null; reload: () => void } {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    fetchFlows(ac.signal)
      .then((r) => setFlows(r.flows))
      .catch(() => {});
    return () => ac.abort();
  }, [n]);
  return { flows, reload: useCallback(() => setN((v) => v + 1), []) };
}
