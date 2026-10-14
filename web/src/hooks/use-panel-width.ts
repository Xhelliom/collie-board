import { useCallback, useState, type PointerEvent } from "react";

const KEY = "collie.orchPanelWidth";
const MIN = 320;
const MAX = 900;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/** A right-hand panel's width, dragged from its left edge and remembered on this device. */
export function usePanelWidth(initial = 384) {
  const [width, setWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem(KEY));
      return n ? clamp(n) : initial;
    } catch {
      return initial;
    }
  });
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = width;
      let last = start;
      const move = (ev: globalThis.PointerEvent) => {
        last = clamp(start + (startX - ev.clientX));
        setWidth(last);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem(KEY, String(last));
        } catch {
          // private mode: the width just doesn't survive a reload
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [width],
  );
  return { width, onPointerDown };
}
