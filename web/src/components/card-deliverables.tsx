import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Download, File, FileCode, FileText, Trash2 } from "lucide-react";

import { DocViewer, byteSize } from "@/components/artifact-viewer";
import { GalleryImg } from "@/components/gallery-img";
import { BottomSheet } from "@/components/ui/sheet";
import { SectionLabel } from "@/components/ui/section-label";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import {
  cardPath,
  deleteDeliverable,
  deliverableKind,
  deliverableUrl,
  fetchDeliverables,
  type CardView,
  type Deliverable,
} from "@/lib/board";
import { openLightbox } from "@/lib/lightbox";
import type { CardFacts } from "@/lib/project-facts";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// What agents published on a card (ADR 0045), where the operator looks for it: the card's own section
// (images as thumbnails into the lightbox, documents in the shared viewer, the rest as a download), and
// the project's recent ones — read off the facts the project page already polls, no request of its own.

const DOC_ICON = { markdown: FileText, html: FileCode, pdf: FileText, file: File } as const;

/** The card's section. Read when the card opens and again when its journal counts one more publish. */
export function CardDeliverables({ cardId, version }: { cardId: string; version: number }) {
  const t = useT();
  const [items, setItems] = useState<Deliverable[]>([]);
  const [open, setOpen] = useState<Deliverable | null>(null);
  const { pending, confirm } = usePendingConfirm();

  useEffect(() => {
    const ctl = new AbortController();
    fetchDeliverables(cardId, ctl.signal).then(
      (r) => setItems(r.deliverables),
      () => {}, // an older bridge, or the card gone: the section stays hidden
    );
    return () => ctl.abort();
  }, [cardId, version]);

  if (items.length === 0) return null;
  const images = items.filter((d) => deliverableKind(d.name) === "image");
  const imageUrls = images.map((d) => deliverableUrl(cardId, d.name));
  const rest = items.filter((d) => deliverableKind(d.name) !== "image");
  const openKind = open ? deliverableKind(open.name) : null;

  const remove = async (d: Deliverable) => {
    if (!confirm(d.name)) return;
    try {
      await deleteDeliverable(cardId, d.name);
      setItems((prev) => prev.filter((x) => x.name !== d.name));
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
  };
  const del = (d: Deliverable) => (
    <button
      type="button"
      onClick={() => void remove(d)}
      aria-label={t("deliv.delete", { name: d.name })}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground active:bg-muted/60",
        pending === d.name && "font-semibold text-destructive",
      )}
    >
      <Trash2 className="size-4" />
      {pending === d.name && t("deliv.confirm")}
    </button>
  );

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{t("card.section.deliverables")}</SectionLabel>
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((d, i) => (
            <li key={d.name} className="flex min-w-0 flex-col">
              <button
                type="button"
                onClick={() => openLightbox(imageUrls, i)}
                aria-label={t("deliv.open", { name: d.name })}
                className="block aspect-square overflow-hidden rounded-md border bg-muted/40"
              >
                <GalleryImg path={imageUrls[i]!} alt={d.name} className="size-full object-cover" />
              </button>
              <div className="flex items-center">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{d.name}</span>
                {del(d)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rest.map((d) => {
            const kind = deliverableKind(d.name);
            const Icon = DOC_ICON[kind as keyof typeof DOC_ICON];
            const body = (
              <>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{d.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{byteSize(d.size)}</span>
                {kind === "file" && <Download className="size-4 shrink-0 text-muted-foreground" />}
              </>
            );
            const row = "flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left";
            return (
              <li key={d.name} className="flex items-center rounded-md border bg-muted/40">
                {kind === "file" ? (
                  <a href={deliverableUrl(cardId, d.name)} download={d.name} aria-label={t("deliv.download", { name: d.name })} className={row}>
                    {body}
                  </a>
                ) : (
                  <button type="button" onClick={() => setOpen(d)} aria-label={t("deliv.open", { name: d.name })} className={row}>
                    {body}
                  </button>
                )}
                {del(d)}
              </li>
            );
          })}
        </ul>
      )}
      <BottomSheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && openKind && openKind !== "image" && openKind !== "file" && (
          <div data-vaul-no-drag className="flex h-[65dvh] flex-col">
            <DocViewer url={deliverableUrl(cardId, open.name)} name={open.name} kind={openKind} fromLabel={t("deliv.fromCard")} />
            {/* A sandboxed frame may refuse a PDF (some browsers will not render one there): the file itself, one tap away. */}
            <a href={deliverableUrl(cardId, open.name)} target="_blank" rel="noopener noreferrer" className="px-3 pb-2 text-xs font-semibold text-primary underline">
              {t("deliv.newTab")}
            </a>
          </div>
        )}
      </BottomSheet>
    </section>
  );
}

export interface RecentDeliverable {
  cardId: string;
  cardTitle: string;
  name: string;
  size: number;
  ts: number;
}

/** The project's deliverables, newest first, each with the card it was published on. Pure. */
export function recentDeliverables(cards: CardView[], facts: Record<string, CardFacts> | undefined, limit = 12): RecentDeliverable[] {
  return cards
    .flatMap((c) => (facts?.[c.id]?.deliverables ?? []).map((d) => ({ cardId: c.id, cardTitle: c.title, ...d })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

/** One line per deliverable: a thumbnail (lightbox) or a link to the file, and its card. */
export function DeliverableLinks({ items, onLeave }: { items: RecentDeliverable[]; onLeave?: () => void }) {
  const t = useT();
  const images = items.filter((d) => deliverableKind(d.name) === "image").map((d) => deliverableUrl(d.cardId, d.name));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((d) => {
        const url = deliverableUrl(d.cardId, d.name);
        const kind = deliverableKind(d.name);
        const Icon = kind === "image" ? null : DOC_ICON[kind];
        return (
          <li key={`${d.cardId}/${d.name}`} className="flex items-center gap-2.5 rounded-[10px] border bg-card/70 px-2.5 py-2">
            {Icon ? (
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("deliv.open", { name: d.name })} className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                <Icon className="size-4 text-muted-foreground" />
              </a>
            ) : (
              <button
                type="button"
                onClick={() => openLightbox(images, images.indexOf(url))}
                aria-label={t("deliv.open", { name: d.name })}
                className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted/40"
              >
                <GalleryImg path={url} alt={d.name} className="size-full object-cover" />
              </button>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm">{d.name}</span>
              <Link to={cardPath(d.cardId)} onClick={onLeave} className="block truncate text-xs text-muted-foreground underline underline-offset-2">
                {t("deliv.onCard", { card: d.cardTitle })}
              </Link>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{byteSize(d.size)}</span>
          </li>
        );
      })}
    </ul>
  );
}
