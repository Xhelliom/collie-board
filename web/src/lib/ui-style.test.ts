import { applyUiStyle, loadUiStyle, saveUiStyle } from "./ui-style";

describe("ui style", () => {
  afterEach(() => {
    localStorage.clear();
    applyUiStyle("semaphore");
  });

  it("defaults to Sémaphore, with no attribute on <html>", () => {
    expect(loadUiStyle()).toBe("semaphore");
    applyUiStyle(loadUiStyle());
    expect(document.documentElement.dataset.style).toBeUndefined();
  });

  it("keeps the classic choice and marks <html> for index.css", () => {
    saveUiStyle("classic");
    expect(loadUiStyle()).toBe("classic");
    expect(document.documentElement.dataset.style).toBe("classic");
    saveUiStyle("semaphore");
    expect(localStorage.getItem("collie:style")).toBeNull();
    expect(document.documentElement.dataset.style).toBeUndefined();
  });
});
