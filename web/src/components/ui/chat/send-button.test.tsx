import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SendButton } from "./send-button";

const base = { label: "Envoyer", stopLabel: "Arrêter l'agent", onClick: () => {} };

describe("SendButton", () => {
  it("is disabled with nothing to send and no turn", () => {
    render(<SendButton {...base} hasContent={false} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  });

  it("is disabled while busy, and shows a spinner", () => {
    render(<SendButton {...base} hasContent busy />);
    const b = screen.getByRole("button", { name: "Envoyer" });
    expect(b).toBeDisabled();
    expect(b.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows a check when armed", () => {
    render(<SendButton {...base} hasContent armed />);
    expect(screen.getByRole("button", { name: "Envoyer" }).querySelector("svg.lucide-check")).not.toBeNull();
  });

  it("becomes Stop during a turn with an empty field", async () => {
    const onStop = vi.fn();
    const onClick = vi.fn();
    render(<SendButton {...base} onClick={onClick} hasContent={false} working onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: "Arrêter l'agent" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays Send during a turn once there is content, and outside a turn", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<SendButton {...base} onClick={onClick} hasContent working onStop={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    rerender(<SendButton {...base} onClick={onClick} hasContent={false} working={false} onStop={() => {}} />);
    expect(screen.queryByRole("button", { name: "Arrêter l'agent" })).toBeNull();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("never offers Stop without an onStop", () => {
    render(<SendButton {...base} hasContent={false} working />);
    expect(screen.queryByRole("button", { name: "Arrêter l'agent" })).toBeNull();
  });
});
