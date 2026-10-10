import { useCallback, useEffect, useState } from "react";

import { fetchTemplates, type TemplatesData } from "@/lib/templates";

/** The templates, loaded once per mount and again on `reload`. Null until the bridge answers (or never, if it does not). */
export function useTemplates(): { data: TemplatesData | null; reload: () => void } {
  const [data, setData] = useState<TemplatesData | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    fetchTemplates(ac.signal)
      .then(setData)
      .catch(() => {});
    return () => ac.abort();
  }, [n]);
  return { data, reload: useCallback(() => setN((v) => v + 1), []) };
}
