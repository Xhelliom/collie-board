import { useEffect, useState } from "react";

import { fetchRepos, type RepoChoice } from "@/lib/board";

/** The repos the bridge knows (`/api/repos`), fetched when `enabled` turns on. Empty until it answers, or if it fails. */
export function useKnownRepos(enabled = true): RepoChoice[] {
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setRepos(r.repos))
      .catch(() => {});
    return () => ac.abort();
  }, [enabled]);
  return repos;
}
