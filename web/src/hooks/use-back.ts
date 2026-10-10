import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * "Back" that goes where you came from. Every screen used to hard-code its parent (the card's chevron
 * always led to the board), so a card opened from the project view came back to the board and a pane
 * opened from a card came back to the herd. React Router marks a session's first entry `default`:
 * past that there is an in-app entry behind us and `-1` is right; on a deep link (a push tap, a
 * pasted URL) there isn't, so the screen's own parent is the way out.
 */
export function useBack(fallback: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    if (key !== "default") void navigate(-1);
    else void navigate(fallback);
  }, [navigate, key, fallback]);
}
