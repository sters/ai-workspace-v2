import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ArtifactFileContent } from "@/types/artifact";
import type { ReviewFileRef } from "@/types/workspace";

const mockUseArtifactFile = vi.fn();
let files: ReviewFileRef[] = [];

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    isWorkspaceRunning: () => false,
    isWorkspaceTypeRunning: () => false,
  }),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useReviewDetail: () => ({ summary: "# Summary", files, isLoading: false }),
  useWorkspace: () => ({ workspace: undefined }),
  useArtifactFile: (...args: unknown[]) => mockUseArtifactFile(...args),
}));

vi.mock("@/components/workspace/review-findings-list", () => ({
  ReviewFindingsList: () => null,
}));

vi.mock("@/components/shared/content/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { ReviewDetail } from "@/components/workspace/review-detail";

const TIMESTAMP = "20260923-140211";

function artifact(overrides: Partial<ArtifactFileContent> = {}): ArtifactFileContent {
  return {
    path: `reviews/${TIMESTAMP}/REVIEW-github.com_acme_widgets.md`,
    size: 120,
    modifiedAt: 1_700_000_000_000,
    kind: "markdown",
    content: "## Critical Issues",
    truncated: false,
    ...overrides,
  };
}

function openSection(name: string) {
  fireEvent.click(screen.getByText(name));
}

describe("ReviewDetail", () => {
  beforeEach(() => {
    mockUseArtifactFile.mockReset();
    mockUseArtifactFile.mockReturnValue({
      file: artifact(),
      isLoading: false,
      error: undefined,
    });
    files = [
      { name: "REVIEW-github.com_acme_widgets.md", size: 120 },
      { name: "VERIFY-FIXES-github.com_acme_widgets.md", size: 80 },
    ];
  });

  it("reads no report file until one is opened", () => {
    render(<ReviewDetail workspaceName="demo" timestamp={TIMESTAMP} />);

    expect(screen.getByText("REVIEW-github.com_acme_widgets.md")).toBeInTheDocument();
    expect(mockUseArtifactFile).not.toHaveBeenCalled();
  });

  it("reads only the opened report, by its path under the review session", () => {
    render(<ReviewDetail workspaceName="demo" timestamp={TIMESTAMP} />);

    openSection("REVIEW-github.com_acme_widgets.md");

    expect(mockUseArtifactFile).toHaveBeenCalledWith(
      "demo",
      `reviews/${TIMESTAMP}/REVIEW-github.com_acme_widgets.md`,
    );
    for (const call of mockUseArtifactFile.mock.calls) {
      expect(call[1]).not.toContain("VERIFY-FIXES");
    }
    expect(screen.getByText("## Critical Issues")).toBeInTheDocument();
  });

  it("stops reading a report that is collapsed again", () => {
    render(<ReviewDetail workspaceName="demo" timestamp={TIMESTAMP} />);

    openSection("REVIEW-github.com_acme_widgets.md");
    mockUseArtifactFile.mockClear();
    openSection("REVIEW-github.com_acme_widgets.md");

    expect(mockUseArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByText("## Critical Issues")).toBeNull();
  });
});
