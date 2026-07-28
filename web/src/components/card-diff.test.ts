import { describe, expect, it } from "vitest";

import { lineClass } from "./card-diff";

// A unified diff's file headers start with the same characters as its content lines, which is the
// one thing a naive prefix check gets wrong — every patch would open with a meaningless green and
// red line.
describe("lineClass", () => {
  it("treats +++ / --- as headers, not as an addition and a removal", () => {
    expect(lineClass("+++ b/src/a.ts")).toBe("text-muted-foreground");
    expect(lineClass("--- a/src/a.ts")).toBe("text-muted-foreground");
  });

  it("colours real additions and removals", () => {
    expect(lineClass("+const x = 1;")).toBe("text-status-done");
    expect(lineClass("-const x = 0;")).toBe("text-status-blocked");
  });

  it("marks hunk headers", () => {
    expect(lineClass("@@ -1,3 +1,4 @@")).toBe("text-status-working");
  });

  it("leaves context lines unstyled", () => {
    expect(lineClass(" unchanged")).toBe("");
    expect(lineClass("")).toBe("");
  });

  it("mutes the git preamble", () => {
    expect(lineClass("diff --git a/x b/x")).toBe("text-muted-foreground");
    expect(lineClass("index 0000000..d86bac9")).toBe("text-muted-foreground");
  });
});
