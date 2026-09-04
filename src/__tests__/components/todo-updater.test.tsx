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

function setRunning(opts: { workspaceRunning?: boolean; updateTodoRunning?: boolean }) {
  mockUseRunningOperations.mockReturnValue({
    isWorkspaceRunning: () => Boolean(opts.workspaceRunning),
    isWorkspaceTypeRunning: (_ws: string, type: string) =>
      type === "update-todo" ? Boolean(opts.updateTodoRunning) : false,
    isRepoTypeRunning: () => false,
  });
}

beforeEach(() => {
  mockStartAndNavigate.mockReset();
});

describe("TodoUpdater", () => {
  it("shows 'Start autonomous' when nothing is running", () => {
    setRunning({});
    render(
      <TodoUpdater
        todos={[makeTodo()]}
        workspacePath="/ws/ws"
        workspaceName="ws"
        repositories={[]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /start autonomous/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/An operation is currently running/i)).not.toBeInTheDocument();
  });

  it("shows the interject banner and button when another operation is running on the workspace", () => {
    setRunning({ workspaceRunning: true });
    render(
      <TodoUpdater
        todos={[makeTodo()]}
        workspacePath="/ws/ws"
        workspaceName="ws"
        repositories={[]}
      />,
    );
    expect(screen.getByText(/An operation is currently running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /interject \+ restart/i })).toBeInTheDocument();
  });

  // The tab is rendered from the TODO files on disk, so a repository declared
  // in the README with no TODO file yet had no card at all — nothing on the
  // screen said it was missing, and there was nothing to click.
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
