import { useState } from "react";
import { useLoaderData } from "react-router";
import { X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { DocViewer, KIND_ICON, KIND_LABEL, byteSize } from "@/components/artifact-viewer";
import { GalleryImg } from "@/components/gallery-img";
import { galleryFileUrl } from "@/lib/api";
import { openLightbox } from "@/lib/lightbox";
import type { GalleryDoc, GalleryImage, GalleryListing } from "@/lib/types";

// Every file sitting in a harness scratchpad, grouped by the session that made it.
//
// An agent that generates pictures — a render, a chart, a mock — writes them to its scratchpad and
// then describes them in words, which is no use at all from a phone. This is the screen that just
// shows them. Images get the grid they always had; Markdown/HTML documents (a validation page, a
// report) get the SHARED document reader both file surfaces use — same scrubbed-bytes +
// sandboxed-iframe contract as the session artifacts, only the root differs (scratchpad here,
// card worktree there). Grouping is by SESSION rather than by project because that's the unit of
// work: one session's eight variants belong together, and two sessions in the same repo usually
// don't.
//
// Not polled. The loader runs on navigation and the route opts out of revalidation (router.tsx) —
// walking the scratchpad tree on the bridge every 1.5 s to catch a picture that appears twice a day
// would be pure waste.

/** Entries in listing order (newest first), grouped by the session that made them. */
export function groupBySession<T extends { project: string; session: string }>(
  items: T[],
): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.project}/${item.session}`;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups].map(([key, list]) => ({ key, items: list }));
}

export function GalleryRoute() {
  const { images, docs } = useLoaderData() as GalleryListing;
  const imageGroups = groupBySession(images);
  const docGroups = groupBySession(docs);
  const [selected, setSelected] = useState<GalleryDoc | null>(null);

  const subtitleParts = [
    `${images.length} image${images.length === 1 ? "" : "s"}`,
    ...(docs.length > 0 ? [`${docs.length} document${docs.length === 1 ? "" : "s"}`] : []),
  ];

  if (selected !== null) {
    const Icon = KIND_ICON[selected.kind];
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
        <AppHeader
          onBack={() => setSelected(null)}
          rightTrail={
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close document"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted/60"
            >
              <X className="size-4" />
            </button>
          }
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded-md border bg-muted/40">
                <Icon className="size-3.5 text-muted-foreground" />
              </span>
              <h1 className="truncate font-semibold leading-tight">{selected.name}</h1>
            </div>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {KIND_LABEL[selected.kind]} · {selected.project} · {selected.session.slice(0, 8)}
            </div>
          </div>
        </AppHeader>
        {/* Keyed by path so switching documents remounts fresh instead of flashing the previous one. */}
        <DocViewer
          key={selected.path}
          url={galleryFileUrl(selected.path)}
          name={selected.name}
          kind={selected.kind}
          fromLabel="from the scratchpad"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title="Gallery" subtitle={subtitleParts.join(" · ")} />
      <h1 className="sr-only">Gallery</h1>

      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {imageGroups.length === 0 && docGroups.length === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            No images yet. Anything an agent writes into its scratchpad — pictures, pages, reports —
            shows up here.
          </p>
        ) : (
          <>
            {imageGroups.map((group) => {
              const paths = group.items.map((i) => i.path);
              return (
                <section key={group.key}>
                  <h2 className="mb-1.5 truncate font-mono text-xs text-muted-foreground">
                    {group.items[0]?.project} · {group.key.split("/")[1]?.slice(0, 8)}
                  </h2>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                    {group.items.map((image: GalleryImage, i: number) => (
                      <button
                        key={image.path}
                        type="button"
                        onClick={() => openLightbox(paths, i)}
                        className="aspect-square overflow-hidden rounded-md border bg-muted/40"
                      >
                        <GalleryImg
                          path={image.path}
                          alt={image.name}
                          className="size-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {docGroups.map((group) => (
              <section key={`docs-${group.key}`}>
                <h2 className="mb-1.5 truncate font-mono text-xs text-muted-foreground">
                  {group.items[0]?.project} · {group.key.split("/")[1]?.slice(0, 8)} · documents
                </h2>
                <ul className="space-y-1">
                  {group.items.map((doc: GalleryDoc) => {
                    const Icon = KIND_ICON[doc.kind];
                    return (
                      <li key={doc.path}>
                        <button
                          type="button"
                          onClick={() => setSelected(doc)}
                          className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-2 text-left"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                            <Icon className="size-4 text-muted-foreground" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm">{doc.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {KIND_LABEL[doc.kind]}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {byteSize(doc.size)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
