// A model slug as a person reads it: `claude-opus-5-5` → « Opus 5.5 ». Shown beside the ctx gauge.

/**
 * Short label for a model slug, or null when the slug names no model (`<synthetic>`, empty).
 * Claude slugs lose the vendor prefix, a date stamp and a `[1m]` window suffix, in either order
 * Anthropic has used (`claude-opus-5-5`, `claude-3-5-sonnet-20241022`). Anything else is not ours
 * to rename: it comes back as written.
 */
export function modelLabel(slug: string | null | undefined): string | null {
  const s = (slug ?? "").trim();
  if (s === "" || s.startsWith("<")) return null;
  const m = /^claude-(.+?)(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(s);
  if (!m) return s;
  const parts = m[1]!.split("-");
  const name = parts.filter((p) => !/^\d+$/.test(p)).join(" ");
  const version = parts.filter((p) => /^\d+$/.test(p)).join(".");
  if (name === "") return s;
  return [name[0]!.toUpperCase() + name.slice(1), version].filter(Boolean).join(" ");
}
