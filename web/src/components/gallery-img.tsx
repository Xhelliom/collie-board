import { useEffect, useRef, useState } from "react";

import { galleryImageUrl } from "@/lib/api";

// The one <img> every gallery surface uses — the transcript thumbnail, the grid tile, the viewer's
// pane. It exists for a single behaviour that none of them can have on their own: RETRY.
//
// A scratchpad is live, agent-written state, so a request can legitimately lose a race with the
// writer — the file is half-written when it's asked for, or lands a beat after the transcript that
// names it. The browser then paints the broken-image state and NEVER asks again, so the picture
// stayed broken until a full page reload even though the bytes had been sitting on disk for minutes.
// Falling back to alt text is right for a file that's genuinely gone (a swept /tmp); it was wrong as
// the answer to "not yet".
//
// So: re-request on error, a few times, backing off. The attempt number rides in the query string
// because re-setting an identical src is a no-op — the browser reuses the failed entry rather than
// going back to the network. The bridge only ever reads `p`, so the extra param is inert there.

/** Waits before each re-request. Length = how many retries; then the alt text stands. */
const RETRY_DELAYS_MS = [700, 2000, 5000];

export function GalleryImg({
  path,
  className,
  alt,
}: {
  /** Absolute path of the image, as the gallery route spells it. */
  path: string;
  className?: string;
  /** Defaults to the filename — what the browser shows if every attempt fails. */
  alt?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new path is a different picture: drop any pending retry and start its attempts from scratch.
  useEffect(() => {
    setAttempt(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path]);

  const url = galleryImageUrl(path);
  return (
    <img
      src={attempt === 0 ? url : `${url}&retry=${attempt}`}
      alt={alt ?? path.split("/").pop() ?? "image"}
      // Only ever loads what's on screen — these are full-size renders over a phone link.
      loading="lazy"
      className={className}
      onError={() => {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return; // out of attempts — the alt text is the answer now
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAttempt((a) => a + 1), delay);
      }}
    />
  );
}
