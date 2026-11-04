import { renderHook, act } from "@testing-library/react";

import { useCopy } from "./use-copy";

// The clipboard copy-with-confirmation used by the transcript's code-block button and the terminal
// mirror's copy-buffer button. On plain HTTP it falls back to execCommand("copy"); a button only
// DISABLES (rather than fail silently) on a browser with neither path.
describe("useCopy", () => {
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  afterEach(() => {
    if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    delete (document as { queryCommandSupported?: unknown }).queryCommandSupported;
    delete (document as { execCommand?: unknown }).execCommand;
    vi.useRealTimers();
  });

  it("falls back to execCommand(\"copy\") outside a secure context, button stays enabled", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    let copiedText = "";
    const exec = vi.fn(() => {
      copiedText = document.querySelector("textarea")?.value ?? "";
      return true;
    });
    Object.assign(document, { queryCommandSupported: () => true, execCommand: exec });
    const { result } = renderHook(() => useCopy());
    expect(result.current.canCopy).toBe(true);

    await act(() => result.current.copy("hello"));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("hello");
    expect(document.querySelector("textarea")).toBeNull();
    expect(result.current.copied).toBe(true);
  });

  it("reports canCopy=false when neither the clipboard API nor the legacy command exists", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.assign(document, { queryCommandSupported: () => false });
    const { result } = renderHook(() => useCopy());
    expect(result.current.canCopy).toBe(false);

    await act(() => result.current.copy("hello"));
    expect(result.current.copied).toBe(false);
  });

  it("copies and shows a confirmation that clears after the timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    const { result } = renderHook(() => useCopy(1500));
    expect(result.current.canCopy).toBe(true);

    await act(() => result.current.copy("hello"));
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.copied).toBe(false);
  });

  it("swallows a clipboard rejection (e.g. denied permission) without throwing", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useCopy());

    await act(() => result.current.copy("hello"));
    expect(result.current.copied).toBe(false);
  });
});
