import { useEffect, useState } from "react";
import { FileCode, FileText, Images, Loader2, ShieldCheck } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import type { ArtifactKind } from "@/lib/types";

// The shared document reader both file surfaces use — the card-worktree artifact list
// (routes/artifacts.tsx) and the scratchpad gallery (routes/gallery.tsx). Images keep their own
// surfaces (grid/lightbox); only the DOCUMENT kinds live here: a sandboxed iframe for HTML, the
// app's own MarkdownText parser for Markdown. The bridge already scrubbed the HTML server-side
// (one shared rule in bridge/scrub.ts for both roots); the `sandbox` attribute is the second lock.

/** The lucide mark for each kind — chosen so a list reads at a glance. */
export const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  image: Images,
  markdown: FileText,
  html: FileCode,
};

export const KIND_LABEL: Record<ArtifactKind, string> = {
  image: "Image",
  markdown: "Markdown",
  html: "HTML",
};

/** A phone-sized size caption: "12 KB" / "1.2 MB" / "430 B". Pure. */
export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]!}`;
}

/**
 * The render body of one Markdown/HTML document, from either root. `url` is the file endpoint
 * the owning surface spells (worktree-confined or scratchpad-confined); `fromLabel` names that
 * root in the load-error line ("from the worktree" / "from the scratchpad").
 */
export function DocViewer({
  url,
  name,
  kind,
  fromLabel,
}: {
  url: string;
  name: string;
  kind: Exclude<ArtifactKind, "image">;
  fromLabel: string;
}) {
  if (kind === "html") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* sandbox without allowances: no scripts, no forms, no top navigation, no popups — and the
            bridge already scrubbed the bytes server-side. The one lock that web security agrees on. */}
        <iframe
          title={`${name} (sandboxed)`}
          sandbox=""
          src={url}
          className="size-full rounded-md border bg-muted/10"
        />
        <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          Sandboxed — scripts and external content are disabled.
        </p>
      </div>
    );
  }

  return <MarkdownViewer textUrl={url} name={name} fromLabel={fromLabel} />;
}

/** Fetches and renders a Markdown document — the same parser the transcript uses. */
function MarkdownViewer({
  textUrl,
  name,
  fromLabel,
}: {
  textUrl: string;
  name: string;
  fromLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setText(null);
    setFailed(false);
    fetch(textUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (alive) setText(body);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [textUrl]);

  if (failed) {
    return (
      <p className="px-3 py-16 text-center text-sm text-muted-foreground">
        Couldn't load {name} {fromLabel}.
      </p>
    );
  }
  if (text === null) {
    return (
      <p className="flex items-center gap-2 px-3 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading…
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <MarkdownText text={text} />
    </div>
  );
}
