// Kept apart from index.ts so the message files can import it without pulling the catalog back in
// (the catalog imports them: index → catalog → messages → index would be a cycle).
type Plural = { one: string; other: string };
export type Entry = { en: string | Plural; fr: string | Plural };

/** An area's messages, checked: both languages, every key. */
export const defineMessages = <K extends string>(m: Record<K, Entry>): Record<K, Entry> => m;
