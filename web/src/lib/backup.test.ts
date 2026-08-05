import { backupFilename, collectClientPrefs } from "./backup";

// The client half of the backup: which localStorage keys ride along, and the file's name.

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
});
