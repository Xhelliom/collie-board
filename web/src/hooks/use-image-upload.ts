import { useState } from "react";
import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from "react";

import * as api from "@/lib/api";
import { setStatus } from "@/lib/status";
import { t } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";

// Attaching a screenshot, once, for every text box that can carry one.
//
// Herdr's socket only carries text, so an image can never be "pasted" anywhere: it is uploaded to a
// host file and the message references its PATH (Claude Code / Codex read images by path). The draft
// never shows that path: it carries a readable `[Image #N]` token at the caret, as Claude Code does,
// and the surface calls `expand()` on what it sends, which puts each path where its token stands —
// once. That round-trip is identical whether the draft is a reply to a live pane or the brain dump of
// a card that doesn't exist yet, so it lives here rather than next to each textarea.
//
// `paneId` is only ever the upload's OWNER: the bridge uses it for the saved filename's prefix and
// the audit line, never to route anything, so a surface with no pane (the new-card sheet) passes its
// own label and gets an honestly-named file.

export function imageToken(n: number): string {
  return `[Image #${n}]`;
}

/**
 * A `data:` URL of the file, or null. The bridge's CSP is `img-src 'self' data:` — a `blob:` URL is
 * refused there and renders as a broken image, so every local preview goes through this.
 */
export function dataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

// What each owner's draft carries, kept past a remount: the composer restores its draft text when a
// pane re-opens, and a token restored without its image would be sent literally.
const store = new Map<string, AttachedImage[]>();

export interface UseImageUploadOptions {
  /** Who the upload belongs to — a real pane id, or a label for a surface that has no pane. */
  paneId: string;
  /** The herdr session to scope the upload to; omit for the primary (the board is always primary). */
  session?: string;
  /** Refuse uploads (a gone pane, a read-only device). */
  disabled?: boolean;
  /** The draft — read to show only the thumbnails whose token is still in it. */
  text: string;
  /** The draft the token is inserted into. */
  setText: Dispatch<SetStateAction<string>>;
  /** The draft's textarea — the token lands at its caret; without it, at the end. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Ran after a token lands — the composer re-focuses its input so the keyboard stays up. */
  onAppended?: () => void;
}

/** An image this draft carries: its token's number, its host path, and a `data:` URL to show it. */
export interface AttachedImage {
  n: number;
  path: string;
  url: string | null;
}

export interface ImageUpload {
  uploading: boolean;
  /** A pasted / picked image waiting in the preview (Attach as is, or Edit first). */
  pending: File | null;
  /** Hand an image to the preview — what paste and the picker both do. */
  pick(file: File): void;
  /** Close the preview without uploading. */
  dismiss(): void;
  /** The images whose token is still in the draft, oldest first. */
  images: AttachedImage[];
  /** Take an image's token back out of the draft. */
  remove(n: number): void;
  /** What to send: the draft with every token replaced by its image's path, set off by spaces. */
  expand(text: string): string;
  /** Upload one file and put its token in the draft — the preview's Attach. */
  uploadImage(file: File): Promise<void>;
  /**
   * Paste handler. Only intercepts when the clipboard actually carries an image file — a plain text
   * paste (the common case) falls through untouched.
   */
  onPaste(e: ClipboardEvent<HTMLElement>): void;
}

export function useImageUpload({
  paneId,
  session,
  disabled,
  text,
  setText,
  inputRef,
  onAppended,
}: UseImageUploadOptions): ImageUpload {
  const key = `${session ?? ""}|${paneId}`;
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [attached, setAttached] = useState<AttachedImage[]>(() => store.get(key) ?? []);
  // A sent (cleared) or hand-edited draft drops the thumbnail with the token.
  const images = attached.filter((a) => text.includes(imageToken(a.n)));

  async function uploadImage(file: File) {
    if (disabled) return;
    setPending(null);
    setUploading(true);
    try {
      const res = await api.uploadImage(paneId, file, session);
      if (res.ok) {
        const url = await dataUrl(file);
        const n = Math.max(0, ...images.map((a) => a.n)) + 1;
        const next = [...images, { n, path: res.path, url }];
        store.set(key, next);
        setAttached(next);
        const el = inputRef?.current;
        setText((prev) => {
          const start = Math.min(el?.selectionStart ?? prev.length, prev.length);
          const end = Math.max(start, Math.min(el?.selectionEnd ?? start, prev.length));
          const before = prev.slice(0, start);
          return `${before}${before && !/\s$/.test(before) ? " " : ""}${imageToken(n)}${prev.slice(end)}`;
        });
        onAppended?.();
        setStatus(t("pane.imageAdded"), "success");
      } else {
        setStatus(res.error, "error");
      }
    } catch (err) {
      setStatus(boardErrorMessage(err), "error");
    } finally {
      setUploading(false);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLElement>) {
    if (disabled) return;
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setPending(file);
          return;
        }
      }
    }
  }

  function pick(file: File) {
    if (!disabled) setPending(file);
  }

  function remove(n: number) {
    setText((prev) => prev.split(imageToken(n)).join("").replace(/ {2,}/g, " ").trim());
  }

  function expand(draft: string) {
    return draft.replace(/\[Image #(\d+)\]/g, (token, num: string, at: number) => {
      const img = images.find((a) => a.n === Number(num));
      if (!img) return token;
      const prev = draft[at - 1];
      const next = draft[at + token.length];
      return `${prev && !/\s/.test(prev) ? " " : ""}${img.path}${next && !/\s/.test(next) ? " " : ""}`;
    });
  }

  return { uploading, pending, pick, dismiss: () => setPending(null), images, remove, expand, uploadImage, onPaste };
}
