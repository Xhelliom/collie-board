import { useState } from "react";
import type { ClipboardEvent, Dispatch, SetStateAction } from "react";

import * as api from "@/lib/api";
import { setStatus } from "@/lib/status";

// Attaching a screenshot, once, for every text box that can carry one.
//
// Herdr's socket only carries text, so an image can never be "pasted" anywhere: it is uploaded to a
// host file and the message references its PATH (Claude Code / Codex read images by path). That
// round-trip — upload, append the path to the draft, report it — is identical whether the draft is a
// reply to a live pane or the brain dump of a card that doesn't exist yet, so it lives here rather
// than being written a second time next to the second textarea.
//
// `paneId` is only ever the upload's OWNER: the bridge uses it for the saved filename's prefix and
// the audit line, never to route anything, so a surface with no pane (the new-card sheet) passes its
// own label and gets an honestly-named file.

export interface UseImageUploadOptions {
  /** Who the upload belongs to — a real pane id, or a label for a surface that has no pane. */
  paneId: string;
  /** The herdr session to scope the upload to; omit for the primary (the board is always primary). */
  session?: string;
  /** Refuse uploads (a gone pane, a read-only device). */
  disabled?: boolean;
  /** The draft the path is appended to. */
  setText: Dispatch<SetStateAction<string>>;
  /** Ran after a path lands — the composer re-focuses its input so the keyboard stays up. */
  onAppended?: () => void;
}

export interface ImageUpload {
  uploading: boolean;
  /** Upload one file and append its host path to the draft. Used by a file picker and by paste. */
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
  setText,
  onAppended,
}: UseImageUploadOptions): ImageUpload {
  const [uploading, setUploading] = useState(false);

  async function uploadImage(file: File) {
    if (disabled) return;
    setUploading(true);
    try {
      const res = await api.uploadImage(paneId, file, session);
      if (res.ok) {
        const path = res.path;
        setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${path}` : path));
        onAppended?.();
        setStatus("Image added — path in message", "success");
      } else {
        setStatus(res.error, "error");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
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
          void uploadImage(file);
          return;
        }
      }
    }
  }

  return { uploading, uploadImage, onPaste };
}
