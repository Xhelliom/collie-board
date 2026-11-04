import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, Dispatch, SetStateAction } from "react";

import * as api from "@/lib/api";
import { setStatus } from "@/lib/status";
import { t } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";

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
  /** The draft — read to show only the thumbnails whose path is still in it. */
  text: string;
  /** The draft the path is appended to. */
  setText: Dispatch<SetStateAction<string>>;
  /** Ran after a path lands — the composer re-focuses its input so the keyboard stays up. */
  onAppended?: () => void;
}

/** An image this draft carries: its host path, and a local URL to show it (null when it can't be). */
export interface AttachedImage {
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
  /** The images whose path is still in the draft, oldest first. */
  images: AttachedImage[];
  /** Take an image's path back out of the draft. */
  remove(path: string): void;
  /** Upload one file and append its host path to the draft — the preview's Attach. */
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
  onAppended,
}: UseImageUploadOptions): ImageUpload {
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [attached, setAttached] = useState<AttachedImage[]>([]);
  // Object URLs outlive nothing: revoked when the surface goes away.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function uploadImage(file: File) {
    if (disabled) return;
    setPending(null);
    setUploading(true);
    try {
      const res = await api.uploadImage(paneId, file, session);
      if (res.ok) {
        const path = res.path;
        // jsdom has no createObjectURL; the thumbnail then falls back to an icon.
        const url = URL.createObjectURL?.(file) ?? null;
        if (url) urls.current.push(url);
        setAttached((prev) => [...prev, { path, url }]);
        setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${path}` : path));
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

  function remove(path: string) {
    setText((prev) => prev.split(path).join("").replace(/ {2,}/g, " ").trim());
    setAttached((prev) => prev.filter((a) => a.path !== path));
  }

  // A sent (cleared) or hand-edited draft drops the thumbnail with the path.
  const images = attached.filter((a) => text.includes(a.path));

  return { uploading, pending, pick, dismiss: () => setPending(null), images, remove, uploadImage, onPaste };
}
