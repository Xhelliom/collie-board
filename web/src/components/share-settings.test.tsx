import { act, fireEvent, render, screen } from "@testing-library/react";
import { setPreference } from "@/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareSettings } from "./share-settings";
import type { RepoShare } from "@/lib/board";

const base: RepoShare = { share: null, remotes: ["origin"], remote: "origin", branch: false, wasShared: false, identity: "me@t", sync: null };
let answer: RepoShare = base;
const fetchRepoShare = vi.fn(async (_r: string, _remote?: string) => answer);
const setRepoShare = vi.fn(async (_p: string, _r: string | null) => ({ ok: true as const }));
const resendJournal = vi.fn(async (_p: string) => ({ ok: true as const, lines: 4 }));

vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  fetchRepoShare: (r: string, remote?: string) => fetchRepoShare(r, remote),
  setRepoShare: (p: string, r: string | null) => setRepoShare(p, r),
  resendJournal: (p: string) => resendJournal(p),
}));

const show = async (a: RepoShare) => {
  answer = a;
  render(<ShareSettings repo="/r/app" />);
  return screen.findByRole("switch");
};
const click = (el: HTMLElement) => act(async () => void fireEvent.click(el));

beforeEach(() => {
  fetchRepoShare.mockClear();
  setRepoShare.mockClear();
  setPreference("fr");
});
afterEach(() => setPreference("en"));

describe("ShareSettings (ADR 0048 §1, §6)", () => {
  it("is off by default, signals an existing branch, and shares only after the confirm", async () => {
    const sw = await show({ ...base, branch: true });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Ce dépôt a déjà un board partagé sur origin.")).toBeInTheDocument();
    await click(sw);
    expect(setRepoShare).not.toHaveBeenCalled();
    expect(screen.getByText("Une sauvegarde du board est prise d'abord.")).toBeInTheDocument();
    expect(screen.getByText(/reconstruit ici/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Confirmer" }));
    expect(setRepoShare).toHaveBeenCalledWith("/r/app", "origin");
  });

  it("warns of the loss before a re-activation", async () => {
    await click(await show({ ...base, wasShared: true }));
    expect(screen.getByText(/est perdu — la sauvegarde le garde/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Annuler" }));
    expect(setRepoShare).not.toHaveBeenCalled();
  });

  it("says how many changes will not go before stopping", async () => {
    const sw = await show({ ...base, share: "origin", sync: { unsent: 3, readOnly: null, offline: true, rewritten: false, error: null } });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Hors ligne · 3 changements non envoyés");
    await click(sw);
    expect(screen.getByText("3 changements ne partiront pas.")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Confirmer" }));
    expect(setRepoShare).toHaveBeenCalledWith("/r/app", null);
  });

  it("shows read-only and up-to-date states", async () => {
    await show({ ...base, share: "origin", sync: { unsent: 0, readOnly: "protected branch", offline: false, rewritten: false, error: null } });
    expect(screen.getByRole("status")).toHaveTextContent("Lecture seule : protected branch");
  });

  it("signals a rewritten remote and resends this pair's journal on the gesture", async () => {
    await show({ ...base, share: "origin", sync: { unsent: 2, readOnly: null, offline: false, rewritten: true, error: null } });
    expect(screen.getByRole("status")).toHaveTextContent("Historique réécrit sur le remote");
    await click(screen.getByRole("button", { name: "Renvoyer mon journal" }));
    expect(resendJournal).toHaveBeenCalledWith("/r/app");
  });

  it("offers no resend while the board is not shared", async () => {
    await show(base);
    expect(screen.queryByRole("button", { name: "Renvoyer mon journal" })).toBeNull();
  });

  it("cannot be turned on without a remote", async () => {
    expect(await show({ ...base, remotes: [], remote: null })).toBeDisabled();
  });
});
