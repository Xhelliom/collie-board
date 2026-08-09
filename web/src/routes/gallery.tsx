import { useLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { GalleryImg } from "@/components/gallery-img";
import { openLightbox } from "@/lib/lightbox";
import type { GalleryImage } from "@/lib/types";

// Every image sitting in a harness scratchpad, grouped by the session that made it.
//
// An agent that generates pictures — a render, a chart, a mock — writes them to its scratchpad and
// then describes them in words, which is no use at all from a phone. This is the screen that just
// shows them. Grouping is by SESSION rather than by project because that's the unit of work: one
// session's eight variants belong together, and two sessions in the same repo usually don't.
//
// Not polled. The loader runs on navigation and the route opts out of revalidation (router.tsx) —
// walking the scratchpad tree on the bridge every 1.5 s to catch a picture that appears twice a day
// would be pure waste.

/** Sessions in listing order (newest image first), each holding its own images in that same order. */
export function groupBySession(images: GalleryImage[]): { key: string; images: GalleryImage[] }[] {
  const groups = new Map<string, GalleryImage[]>();
  for (const image of images) {
    const key = `${image.project}/${image.session}`;
    const existing = groups.get(key);
    if (existing) existing.push(image);
    else groups.set(key, [image]);
  }
  return [...groups].map(([key, list]) => ({ key, images: list }));
}

export function GalleryRoute() {
  const images = useLoaderData() as GalleryImage[];
  const groups = groupBySession(images);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        title="Gallery"
        subtitle={`${images.length} image${images.length === 1 ? "" : "s"}`}
      />
      <h1 className="sr-only">Gallery</h1>

      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            No images yet. Anything an agent writes into its scratchpad shows up here.
          </p>
        ) : (
          groups.map((group) => {
            const paths = group.images.map((i) => i.path);
            return (
              <section key={group.key}>
                <h2 className="mb-1.5 truncate font-mono text-xs text-muted-foreground">
                  {group.images[0]?.project} · {group.key.split("/")[1]?.slice(0, 8)}
                </h2>
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                  {group.images.map((image, i) => (
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
          })
        )}
      </main>
    </div>
  );
}
