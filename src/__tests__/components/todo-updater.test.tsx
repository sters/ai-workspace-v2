import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TodoFile } from "@/types/workspace";

const mockStartAndNavigate = vi.fn();
const mockUseRunningOperations = vi.fn();

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => mockUseRunningOperations(),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => mockStartAndNavigate,
}));

vi.mock("@/hooks/use-openers", () => ({
  useOpeners: () => ({ openers: [] }),
}));

import { TodoUpdater } from "@/components/workspace/todo-updater";

function makeTodo(overrides: Partial<TodoFile> = {}): TodoFile {
  return {
    repoName: "repo-a",
    filename: "TODO-repo-a.md",
    sections: [],
    items: [],
    completed: 0,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    total: 0,
    progress: 0,
    ...overrides,
  };
}

/** `workspaceRunning` is a workspace-wide operation; `busyRepos` are operations on one repository each. */
function setRunning(opts: { workspaceRunning?: boolean; updateTodoRunning?: boolean; busyRepos?: string[] }) {
  const busyRepos = opts.busyRepos ?? [];
  mockUseRunningOperations.mockReturnValue({
    isWorkspaceRunning: () => Boolean(opts.workspaceRunning) || busyRepos.length > 0,
    isWorkspaceTypeRunning: (_ws: string, type: string) =>
      type === "update-todo" ? Boolean(opts.updateTodoRunning) : false,
    isRepoBusy: (_ws: string, repo: string) => Boolean(opts.workspaceRunning) || busyRepos.includes(repo),
  });
}

beforeEach(() => {
  mockStartAndNavigate.mockReset();
});

describe("TodoUpdater", () => {
  // The tab is rendered from the TODO files on disk, so a repository declared
  // in the README with no TODO file yet needs a card of its own to show that
  // it is missing and give it something to click.
  describe("repositories without a TODO file", () => {
    it("lists a declared repository that has no TODO file", () => {
      setRunning({});
      render(
        <TodoUpdater
          todos={[makeTodo()]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[
            { alias: "repo-a", path: "github.com/org/repo-a" },
            { alias: "repo-b", path: "github.com/org/repo-b" },
          ]}
        />,
      );

      expect(screen.getByText("repo-b")).toBeInTheDocument();
      expect(screen.getByText(/no todo file/i)).toBeInTheDocument();
    });

    it("matches a TODO file to its repository by the path's last segment", () => {
      setRunning({});
      render(
        <TodoUpdater
          todos={[makeTodo({ repoName: "repo-a" })]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[{ alias: "some other label", path: "github.com/org/repo-a" }]}
        />,
      );

      expect(screen.queryByText(/no todo file/i)).not.toBeInTheDocument();
    });

    it("matches a parallel worktree by its aliased directory name", () => {
      setRunning({});
      render(
        <TodoUpdater
          todos={[makeTodo({ repoName: "repo-a___dev" })]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[{ alias: "repo-a (dev)", path: "github.com/org/repo-a___dev" }]}
        />,
      );

      expect(screen.queryByText(/no todo file/i)).not.toBeInTheDocument();
    });

    it("plans the missing TODO by starting autonomous from execute for that repo", () => {
      setRunning({});
      render(
        <TodoUpdater
          todos={[makeTodo()]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[
            { alias: "repo-a", path: "github.com/org/repo-a" },
            { alias: "repo-b", path: "github.com/org/repo-b" },
          ]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /plan todos/i }));

      // `execute` reaches the Ensure repositories + Ensure TODOs salvage
      // phases, which plan the file through the full init analysis path.
      expect(mockStartAndNavigate).toHaveBeenCalledWith("autonomous", {
        workspace: "/ws/ws",
        startWith: "execute",
        repo: "repo-b",
      });
    });

    it("shows the missing card even when no repository has a TODO file yet", () => {
      setRunning({});
      render(
        <TodoUpdater
          todos={[]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[{ alias: "repo-a", path: "github.com/org/repo-a" }]}
        />,
      );

      expect(screen.getByText("repo-a")).toBeInTheDocument();
      expect(screen.queryByText(/no todo files found/i)).not.toBeInTheDocument();
    });

    it("keeps the empty state when the README declares no repositories either", () => {
      setRunning({});
      render(
        <TodoUpdater todos={[]} workspacePath="/ws/ws" workspaceName="ws" repositories={[]} />,
      );

      expect(screen.getByText(/no todo files found/i)).toBeInTheDocument();
    });

    it("disables planning while an operation is running on the workspace", () => {
      setRunning({ workspaceRunning: true });
      render(
        <TodoUpdater
          todos={[]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[{ alias: "repo-a", path: "github.com/org/repo-a" }]}
        />,
      );

      expect(screen.getByRole("button", { name: /plan todos/i })).toBeDisabled();
    });

    it("plans a repository while another repository's operation runs, but not one with its own", () => {
      const repositories = [
        { alias: "repo-a", path: "github.com/org/repo-a" },
        { alias: "repo-b", path: "github.com/org/repo-b" },
      ];
      setRunning({ busyRepos: ["repo-a"] });
      const { unmount } = render(
        <TodoUpdater todos={[]} workspacePath="/ws/ws" workspaceName="ws" repositories={repositories} />,
      );
      const [planA, planB] = screen.getAllByRole("button", { name: /plan todos/i });
      expect(planA).toBeDisabled();
      expect(planB).toBeEnabled();
      unmount();
    });
  });

  // Not a quick-fill like the button next to it: there is no instruction a
  // TODO-driven run could carry, since the executor may not push and the merge
  // must be committed and pushed by the phase that verified it.
  describe("Solve PR base branch conflicts", () => {
    function renderTab() {
      render(
        <TodoUpdater
          todos={[makeTodo()]}
          workspacePath="/ws/ws"
          workspaceName="ws"
          repositories={[]}
        />,
      );
    }

    it("starts the merge for the whole workspace with no instruction", () => {
      setRunning({});
      renderTab();

      fireEvent.click(
        screen.getAllByRole("button", { name: /solve pr base branch conflicts/i })[0],
      );

      expect(mockStartAndNavigate).toHaveBeenCalledWith("resolve-base-conflicts", {
        workspace: "/ws/ws",
      });
    });

    it("is disabled while an operation runs, including in interject mode", () => {
      // An interject restarts autonomous; this operation is not part of that
      // restart, and it writes to the worktrees the running one is editing.
      setRunning({ workspaceRunning: true });
      renderTab();

      for (const button of screen.getAllByRole("button", {
        name: /solve pr base branch conflicts/i,
      })) {
        expect(button).toBeDisabled();
      }
      expect(screen.getByRole("button", { name: /interject \+ restart/i })).toBeInTheDocument();
    });
  });

  it("submits update-todo with interject=true in interject mode", () => {
    setRunning({ workspaceRunning: true });
    render(
      <TodoUpdater
        todos={[makeTodo()]}
        workspacePath="/ws/ws"
        workspaceName="ws"
        repositories={[]}
      />,
    );

    const ta = screen.getAllByRole("textbox")[0];
    fireEvent.change(ta, { target: { value: "refresh TODOs" } });
    fireEvent.click(screen.getByRole("button", { name: /interject \+ restart/i }));

    expect(mockStartAndNavigate).toHaveBeenCalledWith(
      "update-todo",
      expect.objectContaining({
        workspace: "/ws/ws",
        instruction: "refresh TODOs",
        interject: "true",
      }),
    );
  });
});
