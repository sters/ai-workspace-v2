import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AnchoredReviewFinding,
  FindingGrounding,
  FindingsTargetPr,
  RepoReviewFindings,
} from "@/types/review-findings";

const mockUseReviewFindings = vi.fn();
const mockStartAndNavigate = vi.fn();
const mockRefresh = vi.fn();
let workspaceRunning = false;

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    isWorkspaceRunning: () => workspaceRunning,
    isWorkspaceTypeRunning: () => false,
  }),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => mockStartAndNavigate,
}));

vi.mock("@/hooks/use-workspace", () => ({
  useReviewFindings: () => mockUseReviewFindings(),
}));

import { ReviewFindingsList } from "@/components/workspace/review-findings-list";

function targetPr(overrides: Partial<FindingsTargetPr> = {}): FindingsTargetPr {
  return {
    repoName: "widgets",
    url: "https://github.com/acme/widgets/pull/42",
    number: 42,
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    baseRefName: "main",
    headSha: "deadbeef",
    staleWorktree: false,
    hasPendingReview: false,
    ...overrides,
  };
}

function finding(overrides: Partial<AnchoredReviewFinding> = {}): AnchoredReviewFinding {
  return {
    id: "id-warning",
    repoName: "widgets",
    path: "src/a.ts",
    line: 11,
    startLine: null,
    side: "RIGHT",
    severity: "warning",
    confidence: "high",
    title: "Rejection is unhandled",
    body: "`fetchUser` can reject and nothing catches it.",
    suggestion: null,
    anchor: "inline",
    anchorReason: null,
    posted: false,
    ...overrides,
  };
}

function grounding(overrides: Partial<FindingGrounding> = {}): FindingGrounding {
  return {
    findingId: "id-warning",
    repoName: "widgets",
    holds: "yes",
    scope: "pr",
    evidence: ["src/a.ts:11"],
    comment: "posted text",
    reason: "confirmed",
    posted: true,
    groundedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function repo(overrides: Partial<RepoReviewFindings> = {}): RepoReviewFindings {
  return {
    repoName: "widgets",
    findings: [finding()],
    pr: targetPr(),
    problem: null,
    ...overrides,
  };
}

function setData(repos: RepoReviewFindings[], groundings: Record<string, FindingGrounding> = {}) {
  mockUseReviewFindings.mockReturnValue({
    repos,
    groundings,
    isLoading: false,
    error: undefined,
    refresh: mockRefresh,
  });
}

function renderList() {
  return render(<ReviewFindingsList workspaceName="feat-x" timestamp="20260901-101010" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceRunning = false;
  setData([repo()]);
});

describe("ReviewFindingsList", () => {
  it("lists a finding with its location and anchor", () => {
    renderList();
    expect(screen.getByText("src/a.ts:11")).toBeInTheDocument();
    expect(screen.getByText("inline")).toBeInTheDocument();
    expect(screen.getByText("Rejection is unhandled")).toBeInTheDocument();
  });

  // The pre-selection is the "not everything" part of the feature: the list is
  // complete, and only what a human would act on starts ticked.
  it("pre-selects Critical and Warning but not Suggestions", () => {
    setData([
      repo({
        findings: [
          finding({ id: "c", severity: "critical" }),
          finding({ id: "w", severity: "warning" }),
          finding({ id: "s", severity: "suggestion" }),
        ],
      }),
    ]);
    renderList();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).not.toBeChecked();
    expect(screen.getByText("2 findings selected")).toBeInTheDocument();
  });

  it("leaves a low-confidence finding unticked even at Warning", () => {
    setData([repo({ findings: [finding({ confidence: "low" })] })]);
    renderList();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("shows a finding already on the PR as posted and refuses to re-select it", () => {
    setData([repo({ findings: [finding({ posted: true })] })]);
    renderList();
    expect(screen.getByText("posted")).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });

  it("says why a finding cannot be posted inline", () => {
    setData([
      repo({
        findings: [
          finding({
            anchor: "file",
            anchorReason: "line 50 of `src/a.ts` is not part of the diff",
          }),
        ],
      }),
    ]);
    renderList();
    expect(screen.getByText("file-level")).toBeInTheDocument();
  });

  it("disables selection for a repository whose branch has no PR", () => {
    setData([repo({ pr: null, problem: "No pull request readable for this branch" })]);
    renderList();
    expect(screen.getByText("no PR")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText("No pull request readable for this branch")).toBeInTheDocument();
  });

  it("flags a pending review, which would make the post fail", () => {
    setData([repo({ pr: targetPr({ hasPendingReview: true }) })]);
    renderList();
    expect(screen.getByText("pending review exists")).toBeInTheDocument();
  });

  it("flags a worktree behind the PR head", () => {
    setData([repo({ pr: targetPr({ staleWorktree: true }) })]);
    renderList();
    expect(screen.getByText("worktree behind PR head")).toBeInTheDocument();
  });

  describe("the select-all toggle", () => {
    it("offers to select everything postable, counted", () => {
      setData([
        repo({
          findings: [
            finding({ id: "w", severity: "warning" }),
            finding({ id: "s", severity: "suggestion" }),
          ],
        }),
      ]);
      renderList();
      fireEvent.click(screen.getByRole("button", { name: "Select all (2)" }));
      expect(screen.getByText("2 findings selected")).toBeInTheDocument();
    });

    it("turns into a clear once everything is selected", () => {
      setData([repo({ findings: [finding({ severity: "warning" })] })]);
      renderList();
      fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
      expect(screen.queryByText(/finding.* selected/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Select all (1)" })).toBeInTheDocument();
    });

    it("counts neither a posted finding nor a repository without a PR", () => {
      setData([
        repo({
          findings: [
            finding({ id: "open", severity: "suggestion" }),
            finding({ id: "done", posted: true }),
          ],
        }),
        repo({ repoName: "gadgets", pr: null, findings: [finding({ id: "no-pr" })] }),
      ]);
      renderList();
      expect(screen.getByRole("button", { name: "Select all (1)" })).toBeInTheDocument();
    });

    it("is not offered when nothing could be posted", () => {
      setData([repo({ pr: null, findings: [finding()] })]);
      renderList();
      expect(screen.queryByRole("button", { name: /select all/i })).not.toBeInTheDocument();
    });
  });

  // The button no longer posts directly: each selected finding is checked against
  // the pushed code first, and that check decides what goes out.
  describe("starting the grounding operation", () => {
    it("sends the selected ids and leaves the review pending by default", async () => {
      renderList();
      fireEvent.click(screen.getByRole("button", { name: /ground & post/i }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate).toHaveBeenCalledWith("post-review-findings", {
        workspace: "feat-x",
        reviewTimestamp: "20260901-101010",
        findingIds: ["id-warning"],
        submit: "false",
      });
    });

    it("submits immediately only when asked", async () => {
      renderList();
      fireEvent.click(screen.getByLabelText(/submit immediately/i));
      fireEvent.click(screen.getByRole("button", { name: /ground & post/i }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate.mock.calls[0][1].submit).toBe("true");
    });

    it("blocks starting while an operation is running for the workspace", () => {
      workspaceRunning = true;
      renderList();
      expect(screen.getByRole("button", { name: /ground & post/i })).toBeDisabled();
    });
  });

  // A verdict from a previous post is the record of a decision. Showing it is
  // what stops the same refuted finding being re-grounded on every visit.
  describe("a previous run's verdicts", () => {
    it("shows why a finding was refuted and leaves it unticked", () => {
      setData([repo()], {
        "id-warning": grounding({
          holds: "no",
          comment: "",
          reason: "handled by the caller at src/b.ts:10",
          posted: false,
        }),
      });
      renderList();
      expect(screen.getByText("refuted")).toBeInTheDocument();
      expect(screen.getByText(/handled by the caller/)).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("names a local-only problem as such", () => {
      setData([repo()], {
        "id-warning": grounding({
          scope: "local-only",
          comment: "",
          reason: "the change is not committed",
          posted: false,
        }),
      });
      renderList();
      expect(screen.getByText("local-only")).toBeInTheDocument();
    });

    it("names a pre-existing defect as such", () => {
      setData([repo()], {
        "id-warning": grounding({ scope: "pre-existing", comment: "", posted: false }),
      });
      renderList();
      expect(screen.getByText("pre-existing")).toBeInTheDocument();
    });

    it("names what the code could not settle", () => {
      setData([repo()], {
        "id-warning": grounding({ holds: "unclear", comment: "", posted: false }),
      });
      renderList();
      expect(screen.getByText("unclear")).toBeInTheDocument();
    });

    // Re-selectable on purpose: a verdict is a record, not a lock, and the
    // branch may have moved since.
    it("still allows re-selecting a refuted finding by hand", () => {
      setData([repo()], {
        "id-warning": grounding({ holds: "no", comment: "", posted: false }),
      });
      renderList();
      const box = screen.getByRole("checkbox");
      expect(box).not.toBeDisabled();
      fireEvent.click(box);
      expect(box).toBeChecked();
    });

    it("shows the comment a grounding actually posted", () => {
      setData([repo({ findings: [finding({ posted: true })] })], {
        "id-warning": grounding({ comment: "この reject は捕捉されていません。" }),
      });
      renderList();
      expect(screen.getByText(/この reject は捕捉されていません/)).toBeInTheDocument();
    });
  });

  it("says there is nothing to post for a review with no structured findings", () => {
    setData([repo({ findings: [] })]);
    renderList();
    expect(screen.getByText(/recorded no structured findings/i)).toBeInTheDocument();
  });
});
