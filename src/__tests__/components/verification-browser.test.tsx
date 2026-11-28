import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "bun:test";
import type { ArtifactEntry } from "@/types/artifact";

const mockUseArtifacts = vi.fn();
const mockUseArtifactFile = vi.fn();
let running = false;

vi.mock("@/lib/router/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-workspace", () => ({
  useArtifacts: (...args: unknown[]) => mockUseArtifacts(...args),
  useArtifactFile: (...args: unknown[]) => mockUseArtifactFile(...args),
}));
vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({ isWorkspaceRunning: (ws: string) => running && ws === "ws" }),
}));
vi.mock("@/hooks/use-start-and-navigate", () => ({ useStartAndNavigate: () => vi.fn() }));
vi.mock("@/components/shared/forms/snippet-picker", () => ({ SnippetPicker: () => null }));

import { VerificationBrowser } from "@/components/workspace/verification-browser";

function file(path: string): ArtifactEntry {
  return { path, name: path.split("/").pop()!, depth: path.split("/").length - 1, isDir: false, size: 1, modifiedAt: 0 };
}

beforeEach(() => {
  mockUseArtifacts.mockReset();
  mockUseArtifactFile.mockReset();
  running = false;
});

describe("VerificationBrowser", () => {
  it("opens the newest report and serves its screenshots from the report's directory", () => {
    mockUseArtifacts.mockReturnValue({
      entries: [
        file("verification/20260101-090000/report.md"),
        file("verification/20260102-090000/report.md"),
        file("verification/20260102-090000/orders.png"),
        file("verification/orders-list.json"),
      ],
      isLoading: false,
    });
    mockUseArtifactFile.mockReturnValue({
      file: { path: "", size: 1, modifiedAt: 0, kind: "markdown", content: "![orders](orders.png)", truncated: false },
    });

    render(<VerificationBrowser workspaceName="ws" />);

    expect(mockUseArtifactFile).toHaveBeenCalledWith("ws", "verification/20260102-090000/report.md");
    expect(screen.getAllByRole("button", { name: /2026-01-0\d/ }).map((b) => b.textContent)).toEqual([
      "2026-01-02 09:00:00",
      "2026-01-01 09:00:00",
    ]);
    expect(screen.getByRole("img", { name: "orders" }).getAttribute("src")).toBe(
      "/api/workspaces/ws/artifacts/file?raw=1&path=verification%2F20260102-090000%2Forders.png",
    );
  });

  it("disables Verify while an operation runs on the workspace", () => {
    mockUseArtifacts.mockReturnValue({ entries: [], isLoading: false });
    mockUseArtifactFile.mockReturnValue({ file: undefined });
    const verifyButton = () => screen.getByRole("button", { name: /Verify with Claude/ }) as HTMLButtonElement;

    const { rerender } = render(<VerificationBrowser workspaceName="ws" />);
    expect(verifyButton().disabled).toBe(false);

    running = true;
    rerender(<VerificationBrowser workspaceName="ws" />);
    expect(verifyButton().disabled).toBe(true);
  });
});
