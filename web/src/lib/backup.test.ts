import { applyClientPrefs, backupFilename, collectClientPrefs } from "./backup";

// The client half of the backup: which localStorage keys ride along, the file's name, and what
// comes back out of a restored document.

describe("backup", () => {
  beforeEach(() => localStorage.clear());

  it("collects every collie: preference and nothing else", () => {
    localStorage.setItem("collie:theme", "dark");
    localStorage.setItem("collie:display-prefs:v3", '{"wrap":true}');
    localStorage.setItem("some-other-app", "keep out");

    expect(collectClientPrefs()).toEqual({
      "collie:theme": "dark",
      "collie:display-prefs:v3": '{"wrap":true}',
    });
  });

  it("names the file after the export date", () => {
    expect(backupFilename("2026-08-05T09:41:12.000Z")).toBe("collie-board-backup-2026-08-05.json");
  });

  it("restores collie: prefs and ignores keys the file has no business setting", () => {
    // The document sat on a filesystem in between, so its keys are input like any other. Parsed
    // rather than written as a literal, so `__proto__` is a real own key here, as it would be.
    const written = applyClientPrefs(
      JSON.parse('{"collie:theme":"light","some-other-app":"not yours","__proto__":"nope"}'),
    );

    expect(written).toBe(1);
    expect(localStorage.getItem("collie:theme")).toBe("light");
    expect(localStorage.getItem("some-other-app")).toBeNull();
  });

  it("round-trips this browser's prefs through collect → apply", () => {
    localStorage.setItem("collie:theme", "dark");
    const saved = collectClientPrefs();
    localStorage.clear();

    expect(applyClientPrefs(saved)).toBe(1);
    expect(localStorage.getItem("collie:theme")).toBe("dark");
  });

  it("survives a document with no client half", () => {
    expect(applyClientPrefs(undefined)).toBe(0);
  });
});
