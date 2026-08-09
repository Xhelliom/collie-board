import { RouterProvider } from "react-router";

import { router } from "./router";
import { BusyBar } from "@/components/busy-bar";
import { IdleLock } from "@/components/idle-lock";
import { ImageLightboxHost } from "@/components/image-lightbox";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { useThemeSync } from "@/hooks/use-theme-sync";
import { useCatchingUp } from "@/lib/idle";

// The idle lock COVERS the app rather than replacing it. It used to render instead of the router,
// which unmounted the whole route tree — and with it every piece of local component state, including
// an in-progress reply draft (composer.tsx keeps its draft, upload and sheets entirely local). Coming
// back from a pause silently ate what you'd typed. Now the router stays mounted and polling is what
// pauses (use-polling's tick reads lib/idle), so resuming restores the exact screen, draft and scroll.
//
// `inert` on a display:contents wrapper takes the covered app out of focus and the a11y tree without
// generating a box, so it can't change layout — the cover already blocks pointers, this closes the
// keyboard path behind it.
export function App() {
  const { locked, unlock } = useIdleLock();
  useThemeSync();
  // The cover outlives the lock by one beat: resuming refetches, and dropping the cover the instant
  // you tap would hand you back the same stale screen it just told you was frozen (see lib/idle).
  const catchingUp = useCatchingUp();
  const covered = locked || catchingUp;
  // BusyBar overlays every route (fixed, top of viewport) — a mutation anywhere shows the strip.
  return (
    <>
      <div style={{ display: "contents" }} inert={covered}>
        <BusyBar />
        <RouterProvider router={router} />
        {/* The viewer is a <dialog showModal()>, which paints in the TOP LAYER — above the cover, no
            matter where it sits in the tree or what z-index the cover carries. So it unmounts while
            covered, or a full-screen render would hide the very panel saying the screen is frozen.
            The store keeps the opening, so resuming brings the image back like everything else. */}
        {!covered && <ImageLightboxHost />}
      </div>
      {covered && <IdleLock onUnlock={unlock} catchingUp={catchingUp} />}
    </>
  );
}
