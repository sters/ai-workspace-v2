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
