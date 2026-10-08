import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  PrCheck,
  PrCheckState,
  PrReviewThread,
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

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  usePullRequests: () => mockUsePullRequests(),
}));

import { PullRequestsView } from "@/components/workspace/pull-requests-view";
import { peekChatHandoff } from "@/lib/chat-handoff";

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
        kind: "review-thread",
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
        kind: "review-thread",
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
  mockPush.mockReset();
  sessionStorage.clear();
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

  describe("a comment outside the diff", () => {
    const reviewBody: PrReviewThread = {
      id: "PRR_summary",
      kind: "review",
      reviewState: "CHANGES_REQUESTED",
      isResolved: false,
      isOutdated: false,
      path: null,
      line: null,
      comments: [
        {
          url: "https://github.com/acme/widgets/pull/42#pullrequestreview-1",
          author: "lead",
          body: "The cache never evicts. Needs a bound.",
          createdAt: "2026-08-04T09:00:00Z",
        },
      ],
    };
    const conversation: PrReviewThread = {
      id: "IC_comment",
      kind: "comment",
      isResolved: false,
      isOutdated: false,
      path: null,
      line: null,
      comments: [
        {
          url: "https://github.com/acme/widgets/pull/42#issuecomment-3",
          author: "lead",
          body: "Please update the changelog too.",
          createdAt: "2026-08-04T12:00:00Z",
        },
      ],
    };

    function withConversation() {
      const base = pr();
      setData({ pullRequests: [pr({ threads: [...base.threads, reviewBody, conversation] })] });
      render(<PullRequestsView workspaceName="feat" />);
    }

    it("lists a review body and a conversation comment as candidates", () => {
      withConversation();
      expect(screen.getByRole("checkbox", { name: /review \(changes requested\)/i })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /pr conversation/i })).toBeInTheDocument();
      expect(screen.getByText("Please update the changelog too.")).toBeInTheDocument();
    });

    it("validates one by its node id, like a thread", () => {
      withConversation();
      fireEvent.click(screen.getByRole("checkbox", { name: /pr conversation/i }));
      fireEvent.click(screen.getByRole("button", { name: "Validate" }));
      expect(mockStartAndNavigate).toHaveBeenCalledWith("validate-pr-comments", {
        workspace: "feat",
        threadIds: ["IC_comment"],
      });
    });

    it("triages one without recording it as a thread to reply in", () => {
      withConversation();
      fireEvent.click(screen.getByRole("checkbox", { name: /review \(changes requested\)/i }));
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));

      const { instruction } = mockStartAndNavigate.mock.calls[0][1];
      expect(instruction).toContain("The cache never evicts. Needs a bound.");
      expect(instruction).not.toContain("| Thread ID |");
    });

    it("hides a minimized comment with the resolved threads", () => {
      const base = pr();
      setData({
        pullRequests: [pr({ threads: [...base.threads, { ...conversation, isResolved: true }] })],
      });
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.queryByText("Please update the changelog too.")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /show 2 resolved/i }));
      expect(screen.getByText("Please update the changelog too.")).toBeInTheDocument();
    });
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

  it("opens a chat whose opening message is the selected comment, starting no operation", () => {
    setData({ validations: { PRRT_open: validation } });
    render(<PullRequestsView workspaceName="feat" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(mockPush).toHaveBeenCalledWith("/workspace/feat/chat/interactive");
    expect(mockStartAndNavigate).not.toHaveBeenCalled();
    const draft = peekChatHandoff("feat")?.discussion ?? "";
    expect(draft).toContain("github.com/acme/widgets/src/cache.ts, line 88");
    expect(draft).toContain("This early return skips the unlock.");
    expect(draft).toContain("The lock is not released on the error path.");
  });

  it("puts a selected failing check in the chat draft too", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    const draft = peekChatHandoff("feat")?.discussion ?? "";
    expect(draft).toContain("Failing check `lint`");
    expect(draft).toContain("https://ci/lint");
  });

  describe("a note on the selection", () => {
    const note = "Options A, B or C. A looks best; if there's a better one, use that.";
    const noteBox = () => screen.getByRole("textbox", { name: /note on .*src\/cache\.ts:88/i });

    function tickAndWrite() {
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.change(noteBox(), { target: { value: note } });
    }

    it("opens a note box under a comment once it is ticked, and not before", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      expect(noteBox()).toBeInTheDocument();
    });

    it("hands the note to triage with the thread it was written on", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));
      expect(mockStartAndNavigate.mock.calls[0][1].instruction).toContain(note);
    });

    it("hands the note to validate, keyed by the thread", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("button", { name: "Validate" }));
      expect(mockStartAndNavigate).toHaveBeenCalledWith("validate-pr-comments", {
        workspace: "feat",
        threadIds: ["PRRT_open"],
        notes: { PRRT_open: note },
      });
    });

    it("hands the note to the chat", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("button", { name: "Chat" }));
      expect(peekChatHandoff("feat")?.discussion).toContain(`My note: ${note}`);
    });

    it("keeps the note when the box is unticked and ticked again", () => {
      setData();
      render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      expect(noteBox()).toHaveValue(note);
    });

    it("keeps the note across leaving the tab, like the Changes tab's comments", () => {
      setData();
      const { unmount } = render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      unmount();
      render(<PullRequestsView workspaceName="feat" />);
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      expect(noteBox()).toHaveValue(note);
    });

    it("drops the notes a started triage carried, so they are not sent twice", async () => {
      mockStartAndNavigate.mockResolvedValue(true);
      setData();
      const { unmount } = render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));
      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      unmount();
      render(<PullRequestsView workspaceName="feat" />);
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      await waitFor(() => expect(noteBox()).toHaveValue(""));
    });

    it("keeps the notes when the triage was refused", async () => {
      mockStartAndNavigate.mockResolvedValue(false);
      setData();
      const { unmount } = render(<PullRequestsView workspaceName="feat" />);
      tickAndWrite();
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));
      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      unmount();
      render(<PullRequestsView workspaceName="feat" />);
      fireEvent.click(screen.getByRole("checkbox", { name: /src\/cache\.ts:88/ }));
      expect(noteBox()).toHaveValue(note);
    });

    it("takes a note on a failing check into triage too", async () => {
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
      fireEvent.change(screen.getByRole("textbox", { name: /note on .*lint/i }), {
        target: { value: "Known flaky snapshot." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Triage" }));
      await waitFor(() => expect(mockStartAndNavigate).toHaveBeenCalled());
      expect(mockStartAndNavigate.mock.calls[0][1].instruction).toContain("Known flaky snapshot.");
    });
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
