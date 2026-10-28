import { haltSummary } from "./halt-reason";

it("a short reason is shown whole, nothing folded", () => {
  expect(haltSummary("PR: push rejected")).toEqual({ head: ["PR: push rejected"], full: "PR: push rejected", more: false });
});

it("a long output without an error line keeps its first three lines", () => {
  const s = haltSummary("a\n\nb\nc\nd\ne");
  expect(s.head).toEqual(["a", "b", "c"]);
  expect(s.more).toBe(true);
});
