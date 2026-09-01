import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AnchoredReviewFinding,
  FindingsTargetPr,
  RepoReviewFindings,
} from "@/types/review-findings";

const mockUseReviewFindings = vi.fn();
const mockRefresh = vi.fn();
let workspaceRunning = false;

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    isWorkspaceRunning: () => workspaceRunning,
    isWorkspaceTypeRunning: () => false,
  }),
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

function repo(overrides: Partial<RepoReviewFindings> = {}): RepoReviewFindings {
  return {
    repoName: "widgets",
    findings: [finding()],
    pr: targetPr(),
    problem: null,
    ...overrides,
  };
}

function setRepos(repos: RepoReviewFindings[]) {
  mockUseReviewFindings.mockReturnValue({
    repos,
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
  setRepos([repo()]);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ reviews: [], results: [] }),
  }) as unknown as typeof fetch;
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
    setRepos([
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

  // Low confidence means the reviewer could not establish the mechanism, which
  // is not something to assert on someone else's PR unprompted.
  it("leaves a low-confidence finding unticked even at Warning", () => {
    setRepos([repo({ findings: [finding({ confidence: "low" })] })]);
    renderList();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("shows a finding already on the PR as posted and refuses to re-select it", () => {
    setRepos([repo({ findings: [finding({ posted: true })] })]);
    renderList();
    expect(screen.getByText("posted")).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });

  it("says why a finding cannot be posted inline", () => {
    setRepos([
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
    setRepos([repo({ pr: null, problem: "No pull request readable for this branch" })]);
    renderList();
    expect(screen.getByText("no PR")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(
      screen.getByText("No pull request readable for this branch"),
    ).toBeInTheDocument();
  });

  it("flags a pending review, which would make the post fail", () => {
    setRepos([repo({ pr: targetPr({ hasPendingReview: true }) })]);
    renderList();
    expect(screen.getByText("pending review exists")).toBeInTheDocument();
  });

  // The anchors came from the local diff, so a worktree that is not at the PR
  // head means the line numbers on screen are not the ones GitHub will use.
  it("flags a worktree behind the PR head", () => {
    setRepos([repo({ pr: targetPr({ staleWorktree: true }) })]);
    renderList();
    expect(screen.getByText("worktree behind PR head")).toBeInTheDocument();
  });

  it("posts the selected ids and leaves the review pending by default", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /post as pending/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/reviews/20260901-101010/post-comments");
    expect(JSON.parse(init.body)).toEqual({
      submit: false,
      findings: [{ id: "id-warning" }],
    });
  });

  it("submits immediately only when asked", async () => {
    renderList();
    fireEvent.click(screen.getByLabelText(/submit immediately/i));
    fireEvent.click(screen.getByRole("button", { name: /post & submit/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).submit).toBe(true);
  });

  it("sends the body the human edited", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /edit comment/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my own wording" } });
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    fireEvent.click(screen.getByRole("button", { name: /post as pending/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).findings).toEqual([
      { id: "id-warning", body: "my own wording" },
    ]);
  });

  it("blocks posting while an operation is running for the workspace", () => {
    workspaceRunning = true;
    renderList();
    expect(screen.getByRole("button", { name: /post as pending/i })).toBeDisabled();
  });

  it("says there is nothing to post for a review with no structured findings", () => {
    setRepos([repo({ findings: [] })]);
    renderList();
    expect(screen.getByText(/recorded no structured findings/i)).toBeInTheDocument();
  });
});
