import { expect, it } from "vitest";

import { haltSentence } from "./halt-sentence";

it("says a known cause in one sentence, never the raw output", () => {
  expect(haltSentence("PR: 502 Bad Gateway <html><body>nginx</body></html>")).toEqual({ key: "halt.github" });
  expect(haltSentence("lot merge: conflict in web/src/a.ts")).toEqual({ key: "halt.conflict" });
  expect(haltSentence("gate could not run: ENOENT")).toEqual({ key: "halt.gate" });
  expect(haltSentence("the check ci failed on GitHub, and the card's agent is gone — relaunch the card to fix it")).toEqual({ key: "halt.ci" });
});

it("an unknown cause: its first readable line, tags stripped, cut short", () => {
  expect(haltSentence("<b>start failed</b>: no slot\nmore\nmore\nmore")).toEqual({ text: "start failed : no slot" });
  const long = haltSentence("x".repeat(300));
  expect("text" in long && long.text.length).toBe(140);
});
