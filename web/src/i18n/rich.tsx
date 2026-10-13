import { Fragment, type ReactNode } from "react";

import { useT, type MessageKey } from "./index";

// A message with inline formatting: `<c>…</c>` is code, `<b>…</b>` is bold. Nothing else is parsed
// and the text is rendered as React nodes, never as HTML.
const TAG = /<(c|b)>(.*?)<\/\1>/g;

export function Rich({ id, params }: { id: MessageKey; params?: Record<string, string | number> }) {
  const t = useT();
  const s = t(id, params);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TAG)) {
    out.push(s.slice(last, m.index));
    out.push(m[1] === "c" ? <code key={m.index} className="break-all">{m[2]}</code> : <strong key={m.index} className="font-medium text-foreground">{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  out.push(s.slice(last));
  return <Fragment>{out}</Fragment>;
}
