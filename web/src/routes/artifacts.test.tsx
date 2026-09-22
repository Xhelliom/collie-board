import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ArtifactsRoute, ArtifactViewer, byteSize } from "./artifacts";
import type { HomeData, PaneArtifactsData } from "@/lib/loaders";
import { ROOT_ROUTE_ID } from "@/lib/loaders";
import type { AgentView, ArtifactInfo } from "@/lib/types";
import { server } from "@/test/setup";

// Fixtures: a real worktree's worth of session artifacts — the same kinds the bridge serves.
const renderPng: ArtifactInfo = {
  path: "/home/me/.herdr/worktrees/collie-board/board-x/docs/hero-recette/render.png",
  name: "render.png",
  rel: "docs/hero-recette/render.png",
  kind: "image",
  size: 34_560,
  mtime: 1_790_000_000,
};

const reportMd: ArtifactInfo = {
  path: "/home/me/.herdr/worktrees/collie-board/board-x/docs/hero-recette/compte-rendu.md",
  name: "compte-rendu.md",
  rel: "docs/hero-recette/compte-rendu.md",
  kind: "markdown",
  size: 412,
  mtime: 1_790_000_100,
};

const pageHtml: ArtifactInfo = {
  path: "/home/me/.herdr/worktrees/collie-board/board-x/docs/hero-recette/validation.html",
  name: "validation.html",
  rel: "docs/hero-recette/validation.html",
  kind: "html",
  size: 1200,
  mtime: 1_790_000_200,
};

const MD_FIXTURE = "# Compte rendu\n\nLes artefacts du worktree s'affichent depuis le téléphone.\n\n- une capture\n- un rapport\n";

const connected = (agents: AgentView[]): HomeData => ({
  bridge: "connected",
  agents,
  shellPanes: [],
  workspaces: [],
  tabs: [],
  device: undefined,
  sessions: [],
  copilotPaneId: null,
  session: undefined,
  snoozedUntil: null,
  notifyCount: 0,
  update: undefined,
  error: false,
  authError: false,
});

const cardAgent = (over: Partial<AgentView> = {}): AgentView => ({
  paneId: "w1:p1",
  workspaceId: "w1",
  workspaceLabel: "collie-board",
  workspaceNumber: 1,
  tabId: "t1",
  agent: "claude",
  status: "idle",
  cwd: "/home/me/.herdr/worktrees/collie-board/board-x",
  focused: false,
  cardId: "c1",
  cardTitle: "Visualiser les artefacts",
  branch: "board/x",
  ...over,
});

/** The artifact-file endpoint each kind's viewer hits. */
const serveBytes = () =>
  server.use(
    http.get("*/api/pane/*/artifact", ({ request }) => {
      const p = new URL(request.url).searchParams.get("p") ?? "";
      if (p.includes("compte-rendu.md")) {
        return new HttpResponse(MD_FIXTURE, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        });
      }
      if (p.includes("validation.html")) {
        return new HttpResponse(
          `<html><head><script>alert(1)</script></head><body><h1>Validation</h1></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox" } },
        );
      }
      return HttpResponse.error();
    }),
  );

describe("byteSize", () => {
  it("sizes for a phone row", () => {
    expect(byteSize(0)).toBe("0 B");
    expect(byteSize(430)).toBe("430 B");
    expect(byteSize(12345)).toBe("12.1 KB");
    expect(byteSize(1_200_000)).toBe("1.1 MB");
    expect(byteSize(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });
});

describe("ArtifactViewer — rendering per kind on fixtures", () => {
  it("renders an image through the confined artifact URL", async () => {
    serveBytes();
    render(<ArtifactViewer paneId="w1:p1" artifact={renderPng} imagePaths={[renderPng.path]} />);
    const img = (await screen.findByRole("img", { hidden: true })) as HTMLImageElement;
    // The pane id is URL-encoded in the path, exactly like every other per-pane API route.
    expect(img.getAttribute("src")).toContain("/api/pane/w1%3Ap1/artifact?p=%2Fhome%2Fme");
    expect(img.getAttribute("src")).toContain("render.png");
  });

  it("renders markdown through the app's own parser — headings and lists, not raw text", async () => {
    serveBytes();
    render(<ArtifactViewer paneId="w1:p1" artifact={reportMd} />);
    // The parser turns the fixture into elements, so the MARKDOWN SOURCE never appears as text:
    expect(await screen.findByText("Compte rendu")).toBeTruthy();
    expect(screen.getByText("une capture")).toBeTruthy();
    expect(screen.getByText("un rapport")).toBeTruthy();
    expect(screen.queryByText("# Compte rendu")).toBeNull();
  });

  it("renders html inside a sandboxed iframe pointing at the scrubbed bytes", () => {
    serveBytes();
    render(<ArtifactViewer paneId="w1:p1" artifact={pageHtml} />);
    const frame = screen.getByTitle("validation.html (sandboxed)") as HTMLIFrameElement;
    // The `sandbox` attribute without allowances is the whole point: no scripts, forms, or
    // top navigation, on top of the bridge's server-side scrub.
    expect(frame.hasAttribute("sandbox")).toBe(true);
    expect(frame.getAttribute("src")).toContain("/api/pane/w1%3Ap1/artifact?p=");
    expect(frame.getAttribute("src")).toContain("validation.html");
    expect(screen.getByText(/sandbox/i)).toBeTruthy();
  });

  it("says so when a markdown report cannot be fetched", async () => {
    server.use(http.get("*/api/pane/*/artifact", () => HttpResponse.error()));
    render(<ArtifactViewer paneId="w1:p1" artifact={reportMd} />);
    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
  });
});

describe("ArtifactsRoute — the list from the loader", () => {
  function mount(artifacts: ArtifactInfo[]) {
    const router = createMemoryRouter(
      [
        {
          id: ROOT_ROUTE_ID,
          path: "/",
          loader: () => connected([cardAgent()]),
          element: <Outlet />,
          children: [
            { index: true, element: <div data-testid="home">HOME</div> },
            {
              path: "pane/:paneId",
              element: <div data-testid="pane">PANE</div>,
            },
            {
              path: "pane/:paneId/artifacts",
              loader: (): PaneArtifactsData => ({
                paneId: "w1:p1",
                session: undefined,
                artifacts,
              }),
              element: <ArtifactsRoute />,
            },
          ],
        },
      ],
      { initialEntries: ["/pane/w1:p1/artifacts"] },
    );
    render(<RouterProvider router={router} />);
  }

  it("lists the session's artifacts with kind, relative path and size", async () => {
    mount([pageHtml, renderPng, reportMd]);
    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeTruthy();
    expect(screen.getByText("render.png")).toBeTruthy();
    expect(screen.getByText("docs/hero-recette/render.png")).toBeTruthy();
    expect(screen.getByText("33.8 KB")).toBeTruthy();
    expect(screen.getByText("compte-rendu.md")).toBeTruthy();
    expect(screen.getByText("validation.html")).toBeTruthy();
    expect(screen.getByText(/3 files in the worktree/)).toBeTruthy();
  });

  it("opens a tapped artifact and closes back to the list", async () => {
    serveBytes();
    mount([reportMd, renderPng]);
    await userEvent.click(await screen.findByRole("button", { name: /compte-rendu\.md/ }));
    expect(await screen.findByRole("heading", { name: "compte-rendu.md" })).toBeTruthy();
    expect(await screen.findByText("Compte rendu")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close artifact" }));
    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeTruthy();
  });

  it("offers the empty state for a pane whose card has no artifacts", async () => {
    mount([]);
    expect(await screen.findByText(/no artifacts yet/i)).toBeTruthy();
    expect(screen.getByText(/0 files in the worktree/)).toBeTruthy();
  });
});