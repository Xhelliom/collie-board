import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useParams, useRouteLoaderData } from "react-router";
import { ArrowLeft, FileCode, FileText, Images, Loader2, ShieldCheck, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { GalleryImg } from "@/components/gallery-img";
import { MarkdownText } from "@/components/markdown-text";
import { paneArtifactUrl } from "@/lib/api";
import { historyPath, panePath } from "@/lib/nav";
import { openLightbox } from "@/lib/lightbox";
import { ROOT_ROUTE_ID, type HomeData, type PaneArtifactsData } from "@/lib/loaders";
import type { ArtifactInfo, ArtifactKind } from "@/lib/types";

// A card session's artifacts — the image/HTML/Markdown files the agent wrote (or touched) while
// working, served from its WORKTREE rather than the harness scratchpad the gallery shows. This is
// the phone's answer to "the agent produced a screenshot / a validation page / a report, and I can't
// open any of it without a laptop".
//
// CONFINES TO THE CARD'S WORKTREE, by construction. The list comes from `/api/pane/:id/artifacts`,
// which the bridge derives from the card's own git diff (+ the conversation's mentioned files); each
// entry carries the absolute in-worktree path. The bytes come from `/api/pane/:id/artifact?p=…`,
// which realpaths the path against the server-derived worktree root and refuses anything outside it
// — a client can never name a path the server didn't offer, and even then only inside the card's
// tree (bridge/artifacts.ts).
//
// RENDERING IS PER KIND. Images render as `<img>` (tap for the full-screen lightbox over every image
// in the list). Markdown is fetched and rendered by the app's own MarkdownText — the same parser as
// the transcript, so a report reads like the conversation that produced it. HTML is shown in a
// SANDBOXED IFRAME: no scripts, no forms, no top navigation, and the bridge has already scrubbed the
// bytes (script/iframe/external-style subtrees dropped) before they ever leave the host.

/** The lucide mark for each kind — chosen so a list reads at a glance. */
const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  image: Images,
  markdown: FileText,
  html: FileCode,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  image: "Image",
  markdown: "Markdown",
  html: "HTML",
};

/** A phone-sized size caption: "12 KB" / "1.2 MB" / "430 B". Pure + exported for the test. */
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
 * The render body of one artifact. Exported so a test can drive it directly with fixtures.
 *
 * The html kind is the one that needs the bridge's scrub + the sandboxed iframe; markdown rides the
 * existing MarkdownText parser; an image is `GalleryImg` over the artifact URL, and tapping it opens
 * the lightbox over EVERY image in the list.
 */
export function ArtifactViewer({
  paneId,
  session,
  artifact,
  imagePaths,
}: {
  paneId: string;
  session?: string;
  artifact: ArtifactInfo;
  /** Every image artifact's path, for the lightbox swipe — passed by the route, absent in tests. */
  imagePaths?: string[];
}) {
  const url = paneArtifactUrl(paneId, artifact.path, session);
  const target = (imagePaths ?? []).indexOf(artifact.path);

  if (artifact.kind === "html") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* sandbox without allowances: no scripts, no forms, no top navigation, no popups — and the
            bridge already scrubbed the bytes server-side. The one lock that web security agrees on. */}
        <iframe
          title={`${artifact.name} (sandboxed)`}
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

  if (artifact.kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <button
          type="button"
          onClick={() => (target < 0 ? openLightbox([artifact.path]) : openLightbox(imagePaths!, target))}
          aria-label={`Open ${artifact.name} full-screen`}
          className="block max-w-full rounded-md border bg-muted/40 p-1"
        >
          <GalleryImg path={artifact.path} url={url} alt={artifact.name} className="max-h-full max-w-full object-contain" />
        </button>
      </div>
    );
  }

  return <MarkdownArtifact textUrl={url} name={artifact.name} />;
}

/** Fetches and renders a Markdown artifact — the same parser the transcript uses. */
function MarkdownArtifact({ textUrl, name }: { textUrl: string; name: string }) {
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
        Couldn't load {name} from the worktree.
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

export function ArtifactsRoute() {
  const data = useLoaderData() as PaneArtifactsData;
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { paneId = "" } = useParams();
  const navigate = useNavigate();
  const session = data.session;

  const agent =
    root.agents.find((a) => a.paneId === paneId) ??
    root.shellPanes.find((p) => p.paneId === paneId);
  const paneTitle = agent?.paneLabel ?? agent?.sessionName ?? agent?.workspaceLabel ?? paneId;

  const [selected, setSelected] = useState<ArtifactInfo | null>(null);
  // Newest-first, exactly as the bridge listed them; taps open one, and the image viewer swipes the
  // whole set.
  const imagePaths = data.artifacts.filter((a) => a.kind === "image").map((a) => a.path);

  const open = (artifact: ArtifactInfo) => setSelected(artifact);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selected !== null ? (
        <AppHeader
          onBack={() => setSelected(null)}
          rightTrail={
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close artifact"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted/60"
            >
              <X className="size-4" />
            </button>
          }
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded-md border bg-muted/40">
                {(() => {
                  const Icon = KIND_ICON[selected.kind];
                  return <Icon className="size-3.5 text-muted-foreground" />;
                })()}
              </span>
              <h1 className="truncate font-semibold leading-tight">{selected.name}</h1>
            </div>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {KIND_LABEL[selected.kind]} · {selected.rel}
            </div>
          </div>
        </AppHeader>
      ) : (
        <AppHeader
          onBack={() => navigate(panePath(paneId, session))}
          title="Artifacts"
          subtitle={`${data.artifacts.length} file${data.artifacts.length === 1 ? "" : "s"} in the worktree · ${paneTitle}`}
        />
      )}

      {/* The screen's one h1 — the header already shows it, so it just needed to say so. */}
      {selected === null && <h1 className="sr-only">Artifacts</h1>}

      {selected !== null ? (
        // The viewer is keyed by path so switching artifacts remounts it fresh (a new fetch, a new
        // iframe) instead of the previous document flashing under the new one.
        <ArtifactViewer
          key={selected.path}
          paneId={paneId}
          session={session}
          artifact={selected}
          imagePaths={imagePaths}
        />
      ) : data.artifacts.length === 0 ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            No artifacts yet. Images, reports and pages an agent writes into its worktree show up here.
          </p>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <ul className="space-y-1">
            {data.artifacts.map((artifact) => {
              const Icon = KIND_ICON[artifact.kind];
              return (
                <li key={artifact.path}>
                  <button
                    type="button"
                    onClick={() => open(artifact)}
                    className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-2 text-left"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">{artifact.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{artifact.rel}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {byteSize(artifact.size)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* The reading view's other door into the same thread — a report sits next to the
              conversation that wrote it. */}
          <button
            type="button"
            onClick={() => navigate(historyPath(paneId, session))}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50"
          >
            <ArrowLeft className="size-3.5" />
            Back to the conversation
          </button>
        </main>
      )}
    </div>
  );
}