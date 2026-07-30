import { renderHook, act } from "@testing-library/react";

import { useCopy } from "./use-copy";

// The clipboard copy-with-confirmation used by the transcript's code-block button and the terminal
// mirror's copy-buffer button. The load-bearing bit is the secure-context gate (UI_AUDIT §6.4): a
// button must DISABLE rather than fail silently on plain HTTP, same as push.ts's detection.
describe("useCopy", () => {
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  afterEach(() => {
    if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    vi.useRealTimers();
  });

  it("reports canCopy=false and never calls the clipboard outside a secure context", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
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
