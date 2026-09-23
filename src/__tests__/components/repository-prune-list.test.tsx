import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryPruneCandidate } from "@/types/repository-prune";

const mockUseCandidates = vi.fn();
const mockPostJson = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/hooks/use-repository-prune-candidates", () => ({
  useRepositoryPruneCandidates: () => mockUseCandidates(),
}));

vi.mock("@/lib/api", () => ({
  postJson: (...args: unknown[]) => mockPostJson(...args),
  fetcher: vi.fn(),
}));

import { RepositoryPruneList } from "@/components/utilities/repository-prune-list";

function candidate(
  overrides: Partial<RepositoryPruneCandidate> = {},
): RepositoryPruneCandidate {
  return {
    repoPath: "github.com/acme/widgets",
    repoName: "widgets",
    lastReferencedAt: "2026-08-24T00:00:00.000Z",
    usedBy: [],
    ...overrides,
  };
}

function listing(repositories: RepositoryPruneCandidate[]) {
  mockUseCandidates.mockReturnValue({
    repositories,
    isLoading: false,
    error: undefined,
    refresh: mockRefresh,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-23T00:00:00.000Z"));
  mockPostJson.mockReset();
  mockPostJson.mockResolvedValue({ ok: true, data: { outcomes: [] } });
  mockRefresh.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RepositoryPruneList", () => {
  it("says how long ago each clone was last referenced", () => {
    listing([candidate()]);
    render(<RepositoryPruneList />);

    expect(screen.getByText("github.com/acme/widgets")).toBeInTheDocument();
    expect(screen.getByText(/30d ago/)).toBeInTheDocument();
  });

  it("refuses to tick a clone a workspace still has a worktree of", () => {
    listing([
      candidate({
        usedBy: [
          {
            workspace: "feature-x-20260101",
            worktreePath: "/root/workspace/feature-x-20260101/github.com/acme/widgets",
          },
        ],
      }),
    ]);
    render(<RepositoryPruneList />);

    expect(screen.getByRole("checkbox", { name: "github.com/acme/widgets" })).toBeDisabled();
    expect(screen.getByText(/feature-x-20260101/)).toBeInTheDocument();
  });

  it("refuses to tick a clone whose usage could not be read", () => {
    listing([candidate({ usageError: "fatal: not a git repository" })]);
    render(<RepositoryPruneList />);

    expect(screen.getByRole("checkbox", { name: "github.com/acme/widgets" })).toBeDisabled();
    expect(screen.getByText(/not a git repository/)).toBeInTheDocument();
  });

  it("posts only the ticked clones", async () => {
    const user = userEvent.setup();
    listing([
      candidate(),
      candidate({ repoPath: "github.com/acme/gadgets", repoName: "gadgets" }),
    ]);
    render(<RepositoryPruneList />);

    await user.click(screen.getByRole("checkbox", { name: "github.com/acme/gadgets" }));
    await user.click(screen.getByRole("button", { name: /delete 1 selected/i }));

    await waitFor(() => expect(mockPostJson).toHaveBeenCalledTimes(1));
    expect(mockPostJson).toHaveBeenCalledWith("/api/repositories/prune", {
      repositories: ["github.com/acme/gadgets"],
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("does not post when the confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listing([candidate()]);
    render(<RepositoryPruneList />);

    await user.click(screen.getByRole("checkbox", { name: "github.com/acme/widgets" }));
    await user.click(screen.getByRole("button", { name: /delete 1 selected/i }));

    expect(mockPostJson).not.toHaveBeenCalled();
  });

  it("reports a refusal the server made after the listing was read", async () => {
    const user = userEvent.setup();
    mockPostJson.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            repoPath: "github.com/acme/widgets",
            deleted: false,
            reason: "In use by 1 worktree(s): feature-late-20260923.",
          },
        ],
      },
    });
    listing([candidate()]);
    render(<RepositoryPruneList />);

    await user.click(screen.getByRole("checkbox", { name: "github.com/acme/widgets" }));
    await user.click(screen.getByRole("button", { name: /delete 1 selected/i }));

    expect(await screen.findByText(/feature-late-20260923/)).toBeInTheDocument();
  });
});
