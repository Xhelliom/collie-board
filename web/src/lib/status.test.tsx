import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Toaster } from "@/components/ui/sonner";
import { clearErrorStatus, clearStatus, setStatus } from "./status";

// The status channel is a façade over Sonner: we observe it through the app's one <Toaster/>.
describe("status channel", () => {
  beforeEach(() => {
    clearStatus();
    render(<Toaster />);
  });

  it("shows a message, and stacks a second one instead of overwriting it", async () => {
    act(() => setStatus("first", "info"));
    act(() => setStatus("second", "success"));
    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("auto-clears a non-error", async () => {
    act(() => setStatus("done", "success", 50));
    expect(await screen.findByText("done")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("done")).not.toBeInTheDocument());
  });

  it("keeps an error until its ✕ is used — a real, labelled button", async () => {
    act(() => setStatus("boom", "error"));
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("boom")).not.toBeInTheDocument());
  });

  it("offers no ✕ on a self-fading tone", async () => {
    act(() => setStatus("Saved", "success"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  // root.tsx runs this on every route change: an error resurfacing on the next screen reads as that
  // screen's failure. A success/info notice ("card created", then navigate) must survive the hop.
  it("clearErrorStatus drops a standing error and leaves any other tone", async () => {
    act(() => setStatus("saved", "success", null));
    act(() => setStatus("failed", "error"));
    expect(await screen.findByText("failed")).toBeInTheDocument();
    act(() => clearErrorStatus());
    await waitFor(() => expect(screen.queryByText("failed")).not.toBeInTheDocument());
    expect(screen.getByText("saved")).toBeInTheDocument();
  });
});
