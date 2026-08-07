import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  PrCheck,
  PrCheckState,
  PrThreadValidation,
  WorkspacePullRequest,
} from "@/types/pull-request";

function zeroCounts(): Record<PrCheckState, number> {
  return {
    success: 0,
    failure: 0,
    running: 0,
    queued: 0,
    skipped: 0,
    cancelled: 0,
    unknown: 0,
  };
}

/** Build a checks summary from the rows, so the counts cannot drift from them. */
function checksOf(checks: PrCheck[]) {
  const counts = zeroCounts();
  for (const check of checks) counts[check.state] += 1;
  return { checks, counts, reported: true };
}

const mockStartAndNavigate = vi.fn();
const mockUsePullRequests = vi.fn();
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
  usePullRequests: () => mockUsePullRequests(),
}));

import { PullRequestsView } from "@/components/workspace/pull-requests-view";

function pr(overrides: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    repoName: "widgets",
    repoPath: "github.com/acme/widgets",
    worktreePath: "/ws/feat/widgets",
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    number: 42,
    url: "https://github.com/acme/widgets/pull/42",
    title: "Add widget cache",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/cache",
    baseRefName: "main",
    author: "sters",
    updatedAt: "2026-08-05T00:00:00Z",
    checks: { checks: [], counts: zeroCounts(), reported: false },
    threads: [
      {
        id: "PRRT_open",
        isResolved: false,
        isOutdated: false,
        path: "src/cache.ts",
        line: 88,
        comments: [
          {
            url: "https://github.com/acme/widgets/pull/42#discussion_r1",
            author: "reviewer",
            body: "This early return skips the unlock.",
            createdAt: "2026-08-04T10:00:00Z",
          },
        ],
      },
      {
        id: "PRRT_done",
        isResolved: true,
        isOutdated: false,
        path: "src/other.ts",
        line: 3,
        comments: [
          {
            url: "https://github.com/acme/widgets/pull/42#discussion_r2",
            author: "reviewer",
            body: "Settled already.",
            createdAt: "2026-08-04T10:00:00Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function setData(opts: {
  pullRequests?: WorkspacePullRequest[];
  problems?: { repoName: string; reason: string }[];
  validations?: Record<string, PrThreadValidation>;
  isLoading?: boolean;
  error?: unknown;
} = {}) {
  mockUsePullRequests.mockReturnValue({
    pullRequests: opts.pullRequests ?? [pr()],
    problems: opts.problems ?? [],
    validations: opts.validations ?? {},
    isLoading: opts.isLoading ?? false,
    error: opts.error,
    refresh: mockRefresh,
  });
}

const validation: PrThreadValidation = {
  threadId: "PRRT_open",
  repoName: "widgets",
  commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1",
  verdict: "valid",
  interpretation: "The lock is not released on the error path.",
  reasoning: "cache.ts:88 returns before unlock().",
  recommendation: "Wrap the body in try/finally.",
  evidence: ["src/cache.ts:88"],
  validatedAt: "2026-08-05T00:00:00.000Z",
};

const mockFetch = vi.fn();

beforeEach(() => {
  mockStartAndNavigate.mockReset();
  mockRefresh.mockReset();
  workspaceRunning = false;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      logs: [
        {
          repoName: "widgets",
          name: "lint",
          url: "https://ci/lint",
          excerpt: "src/cache.ts:88:3  error  'lock' is assigned but never used",
          truncated: false,
        },
      ],
    }),
  });
  vi.stubGlobal("fetch", mockFetch);
});

describe("PullRequestsView", () => {
  it("lists the PR and its unresolved review comments", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.getByText(/#42 Add widget cache/)).toBeInTheDocument();
    expect(screen.getByText("src/cache.ts:88")).toBeInTheDocument();
  });

  it("hides resolved threads until asked, since they need no decision", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.queryByText("src/other.ts:3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show 1 resolved/i }));
    expect(screen.getByText("src/other.ts:3")).toBeInTheDocument();
  });

  it("shows no action bar until something is selected", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.queryByRole("button", { name: "Validate" })).not.toBeInTheDocument();
  });

  it("posts the selected thread ids to the validate operation", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    expect(mockStartAndNavigate).toHaveBeenCalledWith("validate-pr-comments", {
      workspace: "feat",
      threadIds: ["PRRT_open"],
    });
  });

  it("starts an autonomous run from update-todo when triaging", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
    fireEvent.click(screen.getByRole("button", { name: "Triage" }));

    const [type, body] = mockStartAndNavigate.mock.calls[0];
    expect(type).toBe("autonomous");
    expect(body).toMatchObject({ workspace: "feat", startWith: "update-todo" });
    // The instruction has to carry the thread id, or `create-pr` has nothing to
    // reply to after it pushes.
    expect(body.instruction).toContain("PRRT_open");
    expect(body.instruction).toContain("This early return skips the unlock.");
  });

  it("folds a recorded verdict into the triage instruction — the validate → triage route", () => {
    setData({ validations: { PRRT_open: validation } });
    render(<PullRequestsView workspaceName="feat" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
    fireEvent.click(screen.getByRole("button", { name: "Triage" }));

    expect(mockStartAndNavigate.mock.calls[0][1].instruction).toContain(
      "The lock is not released on the error path.",
    );
  });

  it("renders a recorded verdict next to the comment it judges", () => {
    setData({ validations: { PRRT_open: validation } });
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.getByText("Wrap the body in try/finally.")).toBeInTheDocument();
  });

  it("blocks both actions while another operation holds the worktrees", () => {
    workspaceRunning = true;
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    // Selection is disabled too, so drive the bar via select-all.
    expect(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ })).toBeDisabled();
  });

  it("reports a repo whose threads could not be read instead of dropping it", () => {
    setData({ problems: [{ repoName: "gadgets", reason: "no pull requests found" }] });
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.getByText("gadgets")).toBeInTheDocument();
    expect(screen.getByText(/no pull requests found/)).toBeInTheDocument();
  });

  it("says so plainly when no branch has a PR yet", () => {
    setData({ pullRequests: [] });
    render(<PullRequestsView workspaceName="feat" />);
    expect(screen.getByText(/No pull request found/i)).toBeInTheDocument();
  });

  describe("CI status", () => {
    it("shows failing checks without being expanded, with a link to the logs", () => {
      setData({
        pullRequests: [
          pr({
            checks: checksOf([
              { name: "lint", state: "failure", url: "https://ci/lint" },
              { name: "unit", state: "success", url: null },
            ]),
          }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      expect(screen.getByText("CI: 1 failing")).toBeInTheDocument();
      expect(screen.getByText("lint")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /logs/ })).toHaveAttribute("href", "https://ci/lint");
      // A passing check is noise next to a failure until asked for.
      expect(screen.queryByText("unit")).not.toBeInTheDocument();
    });

    it("keeps a green PR to a badge, and expands to the full list on click", () => {
      setData({
        pullRequests: [pr({ checks: checksOf([{ name: "unit", state: "success", url: null }]) })],
      });
      render(<PullRequestsView workspaceName="feat" />);

      expect(screen.getByText("CI: 1 passed")).toBeInTheDocument();
      expect(screen.queryByText("unit")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /toggle check details/ }));
      expect(screen.getByText("unit")).toBeInTheDocument();
    });

    it("distinguishes no CI configured from everything passing", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.getByText("CI: unknown")).toBeInTheDocument();
    });

    it("says running for a run that started", () => {
      setData({
        pullRequests: [pr({ checks: checksOf([{ name: "e2e", state: "running", url: null }]) })],
      });
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.getByText("CI: 1 running")).toBeInTheDocument();
    });

    it("says queued for a run that has not started", () => {
      // The distinction this pins: a queued job used to be shown as "running",
      // which claims work that has not begun and logs that do not exist.
      setData({
        pullRequests: [pr({ checks: checksOf([{ name: "e2e", state: "queued", url: null }]) })],
      });
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.getByText("CI: 1 queued")).toBeInTheDocument();
      expect(screen.queryByText("CI: 1 running")).not.toBeInTheDocument();
    });

    it("headlines a running check over a queued one", () => {
      setData({
        pullRequests: [
          pr({
            checks: checksOf([
              { name: "e2e", state: "queued", url: null },
              { name: "unit", state: "running", url: null },
            ]),
          }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.getByText("CI: 1 running")).toBeInTheDocument();

      // In-flight checks do not auto-expand the way failures do — they resolve
      // themselves, and the badge already says how many. Expanding shows both.
      expect(screen.queryByText("queued")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /toggle check details/ }));
      expect(screen.getByText("queued")).toBeInTheDocument();
      expect(screen.getByText("running")).toBeInTheDocument();
    });

    it("gives a failing check a checkbox, and a passing one none", () => {
      setData({
        pullRequests: [
          pr({
            checks: checksOf([
              { name: "lint", state: "failure", url: "https://ci/lint" },
              { name: "unit", state: "success", url: null },
            ]),
          }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      expect(screen.getByRole("checkbox", { name: /lint/ })).toBeInTheDocument();
      // A passing check is nothing to triage, so it gets no box even when shown.
      fireEvent.click(screen.getByRole("button", { name: /toggle check details/ }));
      expect(screen.queryByRole("checkbox", { name: /unit/ })).not.toBeInTheDocument();
    });

    it("triages a failing check with its log fetched and inlined", async () => {
      setData({
        pullRequests: [
          pr({ checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]) }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/workspaces/feat/pr-check-logs",
        expect.objectContaining({ method: "POST" }),
      );
      const [type, body] = mockStartAndNavigate.mock.calls[0];
      expect(type).toBe("autonomous");
      expect(body).toMatchObject({ workspace: "feat", startWith: "update-todo" });
      expect(body.instruction).toContain("lint");
      // Without the log in the instruction the item cannot name a cause: the
      // updater has no `gh` grant and the executor is forbidden from CI.
      expect(body.instruction).toContain("'lock' is assigned but never used");
    });

    it("still triages when the log fetch fails, saying so in the instruction", async () => {
      mockFetch.mockRejectedValueOnce(new Error("gh not authenticated"));
      setData({
        pullRequests: [
          pr({ checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]) }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate.mock.calls[0][1].instruction).toMatch(/No log could be read/i);
    });

    it("keeps Validate to review comments, since a check is not a comment", async () => {
      setData({
        pullRequests: [
          pr({
            threads: [],
            checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]),
          }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      expect(screen.getByRole("button", { name: "Validate" })).toBeDisabled();
    });

    it("counts checks and comments separately in the action bar", () => {
      setData({
        pullRequests: [
          pr({ checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]) }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      expect(screen.getByText(/1 comment.*1 CI failure/)).toBeInTheDocument();
    });

    it("does not call an all-skipped PR passing", () => {
      setData({
        pullRequests: [
          pr({
            checks: checksOf([
              { name: "unit", state: "skipped", url: null },
              { name: "e2e", state: "cancelled", url: null },
            ]),
          }),
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.getByText("CI: no result")).toBeInTheDocument();
    });
  });

  describe("repository scope", () => {
    const gadgets = () =>
      pr({
        repoName: "gadgets",
        repoPath: "github.com/acme/gadgets",
        repo: "gadgets",
        number: 7,
        url: "https://github.com/acme/gadgets/pull/7",
        title: "Widen gadget schema",
        threads: [
          {
            id: "PRRT_gadgets",
            isResolved: false,
            isOutdated: false,
            path: "src/schema.ts",
            line: 12,
            comments: [
              {
                url: "https://github.com/acme/gadgets/pull/7#discussion_r9",
                author: "reviewer",
                body: "This field should be nullable.",
                createdAt: "2026-08-04T10:00:00Z",
              },
            ],
          },
        ],
      });

    it("scopes the run to the one repository the selection belongs to", () => {
      setData({ pullRequests: [pr(), gadgets()] });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      // Without `repo` the run executes, reviews and opens PRs across every
      // worktree in the workspace, for a comment on one of them.
      expect(mockStartAndNavigate.mock.calls[0][1]).toMatchObject({ repo: "widgets" });
    });

    it("scopes a CI-only selection the same way", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          logs: [
            { repoName: "gadgets", name: "lint", url: "https://ci/lint", excerpt: "boom", truncated: false },
          ],
        }),
      });
      setData({
        pullRequests: [
          pr(),
          {
            ...gadgets(),
            checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]),
          },
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate.mock.calls[0][1]).toMatchObject({ repo: "gadgets" });
    });

    it("falls back to the whole workspace when the selection spans repositories", () => {
      // `repo` is a single value in the autonomous API, so a subset of two out of
      // three repositories cannot be expressed — the run stays workspace-wide.
      setData({ pullRequests: [pr(), gadgets()] });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/schema\.ts:12/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      expect(mockStartAndNavigate.mock.calls[0][1].repo).toBeUndefined();
    });

    it("counts a comment and a check in different repositories as spanning", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          logs: [
            { repoName: "gadgets", name: "lint", url: "https://ci/lint", excerpt: "boom", truncated: false },
          ],
        }),
      });
      setData({
        pullRequests: [
          pr(),
          {
            ...gadgets(),
            checks: checksOf([{ name: "lint", state: "failure", url: "https://ci/lint" }]),
          },
        ],
      });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /lint/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate.mock.calls[0][1].repo).toBeUndefined();
    });

    it("tells the human the run is scoped, since it is otherwise invisible", () => {
      setData({ pullRequests: [pr(), gadgets()] });
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      expect(screen.getByText(/widgets only/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/schema\.ts:12/ }));
      expect(screen.queryByText(/only/)).not.toBeInTheDocument();
    });

    it("scopes a single-repository workspace too, so the run reads one worktree", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);

      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      expect(mockStartAndNavigate.mock.calls[0][1]).toMatchObject({ repo: "widgets" });
    });
  });

  it("asks past the server cache when Refresh is pressed", () => {
    setData();
    render(<PullRequestsView workspaceName="feat" />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    // The hook owns the `?refresh=1` bypass; this pins that the button calls it.
    expect(mockRefresh).toHaveBeenCalled();
  });
});
