import { useSyncExternalStore } from "react";

import type { TranscriptEntry } from "./types";

// Which images the full-screen viewer is showing, as a module store — the same shape as
// lib/status.ts, and for the same reason: the viewer is opened from places that have no component
// relationship to each other (a thumbnail inside a transcript turn, a button in the history header,
// a tile on the gallery screen) and there is only ever one of it on screen. Threading state through
// those three trees would be prop-drilling for a singleton.
//
// One `<ImageLightbox>` is mounted at the root and reads this; anything else just calls openLightbox().

export interface LightboxState {
  /** Absolute image paths, in display order. */
  images: string[];
  /** Which one is showing. */
  index: number;
}

let current: LightboxState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Open the viewer on `images`, starting at `index`. An empty list or a bad index is a no-op. */
export function openLightbox(images: string[], index = 0): void {
  if (images.length === 0 || index < 0 || index >= images.length) return;
  current = { images, index };
  emit();
}

export function closeLightbox(): void {
  current = null;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): LightboxState | null {
  return current;
}

export function useLightbox(): LightboxState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Every image a session's transcript touched, oldest first and de-duplicated — the set you swipe
 * through from inside a thread. Derived from the turns rather than from a directory listing, so it
 * is exactly "what this session looked at", in the order it looked: an agent that re-reads one
 * render five times still contributes one entry. Pure.
 */
export function collectImages(entries: TranscriptEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (part.kind === "tool" && part.image) seen.add(part.image);
    }
  }
  return [...seen];
}
