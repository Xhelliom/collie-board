import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { fetchExistingFiles, paneFileUrl } from "@/lib/api";
import { FileLinksContext, fileRefCandidates, type FileLinks, type FileRef } from "@/lib/files-link";
import type { TranscriptEntry } from "@/lib/types";

// The reading view's file links: the paths the agent names become tappable when they exist in the
// pane's folder, and open read-only in a sheet — code at its line, an image or a Markdown preview.
// Existence is asked once per NEW path, as one grouped call riding on the turns the reading view
// already pulls: no timer of its own.

const IMAGE = /\.(png|jpe?g|webp|gif)$/i; // the bridge's IMAGE_TYPES (bridge/gallery.ts)
const MARKDOWN = /\.(md|markdown|mdown)$/i;

export function FileLinksProvider({
  paneId,
  session,
  entries,
  children,
}: {
  paneId: string;
  session?: string;
  entries: TranscriptEntry[];
  children: ReactNode;
}) {
  const [existing, setExisting] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<FileRef | null>(null);
  const asked = useRef(new Set<string>());
  // A peer's pane (`id@peer`) is read through the relay, which has no file routes.
  const enabled = !paneId.includes("@");

  useEffect(() => {
    if (!enabled) return;
    const fresh = fileRefCandidates(entries).filter((p) => !asked.current.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) asked.current.add(p);
    let alive = true;
    fetchExistingFiles(paneId, fresh, session)
      .then((found) => {
        if (alive && found.length > 0) setExisting((prev) => new Set([...prev, ...found]));
      })
      .catch(() => {
        for (const p of fresh) asked.current.delete(p); // asked again with the next turns
      });
    return () => {
      alive = false;
    };
  }, [entries, paneId, session, enabled]);

  const links = useMemo<FileLinks>(() => ({ has: (p) => existing.has(p), open: setOpened }), [existing]);

  return (
    <FileLinksContext.Provider value={links}>
      {children}
      <BottomSheet open={opened !== null} onClose={() => setOpened(null)} title={opened?.path ?? ""}>
        {opened && <FileView url={paneFileUrl(paneId, opened.path, session)} fileRef={opened} />}
      </BottomSheet>
    </FileLinksContext.Provider>
  );
}

/** One file, read-only: an image, a Markdown preview, or numbered lines scrolled to `line`. */
export function FileView({ url, fileRef }: { url: string; fileRef: FileRef }) {
  const t = useT();
  const image = IMAGE.test(fileRef.path);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (image) return;
    let alive = true;
    setText(null);
    setFailed(false);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.text();
      })
      .then((body) => alive && setText(body))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url, image]);

  useEffect(() => {
    target.current?.scrollIntoView?.({ block: "center" });
  }, [text]);

  if (image) return <img src={url} alt={fileRef.path} className="mx-auto max-h-[70dvh] max-w-full object-contain" />;
  if (failed) return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("pane.file.failed")}</p>;
  if (text === null)
    return (
      <p className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t("common.loading")}
      </p>
    );
  if (MARKDOWN.test(fileRef.path) && fileRef.line === undefined) return <MarkdownText text={text} />;
  return (
    <pre className="overflow-x-auto font-mono text-xs leading-5">
      {text.split("\n").map((line, i) => {
        const hit = i + 1 === fileRef.line;
        return (
          <div key={i} ref={hit ? target : undefined} data-line={i + 1} className={hit ? "bg-find-hit" : undefined}>
            <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">{i + 1}</span>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
