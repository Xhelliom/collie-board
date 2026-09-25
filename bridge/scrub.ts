// HTML scrubbing for agent-authored pages — the one place agent bytes are interpreted as markup.
//
// Extracted from artifacts.ts so both file roots (the card worktree AND the harness scratchpad)
// scrub with the same rule: the survival rule is "a `script` tag names a script even if it once
// contained prose" — everything in these subtrees is dropped, and everything else is kept but
// neutered. The sandboxed iframe / `sandbox` CSP is the second lock; the scrubber is the first,
// and it is the one that keeps the served bytes clean even outside the iframe.

/** Tags whose whole subtree is discarded — each is a script/foreign-content host. */
const SCRUB_BLOCK_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "noscript",
  "noembed",
]);

/** Index just past the first `</tag>` close tag at/after `from`, or -1 when the block never closes. */
function closeTagEnd(html: string, tag: string, from: number): number {
  // `g` is load-bearing: without it lastIndex is ignored and the match can land BEFORE `from`,
  // which would send the scanner's cursor backward — an infinite loop on a second block tag.
  const re = new RegExp(`</${tag}\\s*>`, "gi");
  re.lastIndex = from;
  const m = re.exec(html);
  return m === null ? -1 : m.index + m[0]!.length;
}

/** True when a `<link …>` tag is an external stylesheet (`rel` contains `stylesheet`). */
function isStylesheetLink(tag: string): boolean {
  const m = /\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(tag);
  if (m === null) return false;
  const rel = m[1]!.replace(/^["']|["']$/g, "").toLowerCase();
  return rel.split(/\s+/).includes("stylesheet");
}

/** Strip `onclick="…"`-style event-handler attributes from a surviving tag. */
function scrubEventHandlers(tag: string): string {
  return tag.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Scrub agent-written HTML for safe display. Pure + exported so a fixture can pin the rules.
 *
 * Removed: the whole subtree of `script`/`iframe`/`object`/`embed`/`frame`/`frameset` (and the
 * no-script variants), external `<link rel=stylesheet>` tags, and `on*` attributes on any tag that
 * survives. Kept: the document's own inline `<style>` (its `@import`s can't fetch under sandbox) and
 * everything else, on the assumption that the sandboxed context renders it inert.
 *
 * The scanner is a small tag tokenizer, not a regex over the whole document, because agent HTML is
 * arbitrary: a `>` inside quoted attribute values must not end a tag early, and a `>` inside a
 * script body must not defeat the block drop. Script bodies are never tokenized — they are skipped
 * in one `</script>` search, so `if (a > b)` cannot smuggle anything past.
 */
export function scrubHtml(html: string): string {
  const out: string[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));

    // Comments stay whole; the doc keeps its annotations.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) {
        out.push(html.slice(lt));
        break;
      }
      out.push(html.slice(lt, end + 3));
      i = end + 3;
      continue;
    }

    // Declarations (`<!DOCTYPE …>`) and processing instructions (`<?…>`) stay whole.
    const bang = html[lt + 1];
    if (bang === "!" || bang === "?") {
      const gt = html.indexOf(">", lt + 2);
      if (gt === -1) {
        out.push(html.slice(lt));
        break;
      }
      out.push(html.slice(lt, gt + 1));
      i = gt + 1;
      continue;
    }

    // Tag name — letters, digits, `:`, `_`, `-` (namespaces, custom elements). A leading `/`
    // marks a CLOSE tag, which is kept verbatim (a block tag's close is consumed by the skip below,
    // so any `</…>` that reaches here is a normal close).
    let j = lt + 1;
    let closing = false;
    if (html[j] === "/") {
      closing = true;
      j++;
    }
    let name = "";
    while (j < n && /[A-Za-z0-9:_-]/.test(html[j]!)) {
      name += html[j]!;
      j++;
    }
    const lower = name.toLowerCase();
    if (lower === "") {
      out.push("<"); // a stray `<` that isn't a tag — literal text
      i = lt + 1;
      continue;
    }

    // Scan to the tag's `>`, honouring quoted attribute values so a `>` inside one doesn't end the
    // tag early — and an attribute value can't smuggle a tag boundary.
    let k = j;
    let quote = "";
    while (k < n) {
      const ch = html[k]!;
      if (ch === '"' || ch === "'") {
        if (quote === "") quote = ch;
        else if (quote === ch) quote = "";
      } else if (ch === ">" && quote === "") {
        break;
      }
      k++;
    }
    const tagText = html.slice(lt, k + 1);
    const selfClosing = tagText.endsWith("/>");

    if (SCRUB_BLOCK_TAGS.has(lower)) {
      // Drop the whole element. A self-closing one is just its tag; anything else goes through the
      // first matching close tag — content between is discarded untokenized.
      let next = k + 1;
      if (!selfClosing) {
        const end = closeTagEnd(html, lower, k + 1);
        next = end === -1 ? n : end;
      }
      // Belt: never let the cursor move backward, whatever a pathological document did to the scan.
      i = next > i ? next : k + 1;
      continue;
    }

    if (closing) {
      out.push(scrubEventHandlers(tagText));
      i = k + 1;
      continue;
    }

    if (lower === "link" && isStylesheetLink(tagText)) {
      i = k + 1; // external stylesheets don't load in a sandbox, and their CSP is not ours to trust
      continue;
    }

    out.push(scrubEventHandlers(tagText));
    i = k + 1;
  }
  return out.join("");
}
