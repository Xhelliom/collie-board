import { describe, expect, it } from "vitest";

import { CATALOG } from "./catalog";
import { board } from "./messages/board";
import { card } from "./messages/card";
import { common } from "./messages/common";
import { languageMessages } from "./messages/language";
import { orchestrator } from "./messages/orchestrator";
import { project } from "./messages/project";
import { prs } from "./messages/prs";
import { sheets } from "./messages/sheets";

const forms = (v: string | { one: string; other: string }) => (typeof v === "string" ? [v] : [v.one, v.other]);
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("the message catalog", () => {
  it("has no key defined in two areas — the spread would let the last one win silently", () => {
    const all = [common, board, card, project, prs, sheets, orchestrator, languageMessages].flatMap((a) => Object.keys(a));
    expect(all.filter((k, i) => all.indexOf(k) !== i)).toEqual([]);
    expect(Object.keys(CATALOG).length).toBe(all.length);
  });

  it("says everything in both languages, with the same placeholders on both sides", () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      const en = forms(entry.en);
      const fr = forms(entry.fr);
      expect(en.every((s) => s.trim() !== ""), `${key}: empty en`).toBe(true);
      expect(fr.every((s) => s.trim() !== ""), `${key}: empty fr`).toBe(true);
      // A plural entry in one language is a plural entry in the other — `count` picks the form.
      expect(typeof entry.en, `${key}: plural in one language only`).toBe(typeof entry.fr);
      const wanted = new Set(en.flatMap(params));
      for (const s of fr) expect(params(s).every((p) => wanted.has(p) || p === "count"), `${key}: fr uses a placeholder en does not (${s})`).toBe(true);
      for (const s of en) expect(params(s).every((p) => new Set(fr.flatMap(params)).has(p) || p === "count"), `${key}: en uses a placeholder fr lacks (${s})`).toBe(true);
    }
  });
});
