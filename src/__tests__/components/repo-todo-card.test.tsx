import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TodoFile } from "@/types/workspace";

const mockStartAndNavigate = vi.fn();

vi.mock("@/hooks/use-openers", () => ({
  useOpeners: () => ({ openers: [{ name: "VSCode", command: "code" }] }),
}));

import { RepoTodoCard } from "@/components/workspace/repo-todo-card";

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

function renderCard(todo: TodoFile = makeTodo()) {
  return render(
    <RepoTodoCard
      todo={todo}
      workspacePath="/ws/ws"
      disabled={false}
      repoPath="github.com/acme/repo-a"
      onStartAndNavigate={mockStartAndNavigate}
    />,
  );
}

beforeEach(() => {
  mockStartAndNavigate.mockReset();
});

describe("RepoTodoCard action row", () => {
  it("orders the actions autonomous, execute, review, create PR, open in", () => {
    renderCard();
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("title") ?? b.getAttribute("aria-label"))
      .filter((l): l is string =>
        ["Autonomous", "Execute", "Review", "Create PR", "Open in..."].includes(
          l ?? "",
        ),
      );
    expect(labels).toEqual([
      "Autonomous",
      "Execute",
      "Review",
      "Create PR",
      "Open in...",
    ]);
  });

  it("starts autonomous scoped to the repo by name", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Autonomous"));
    expect(mockStartAndNavigate).toHaveBeenCalledWith("autonomous", {
      workspace: "/ws/ws",
      repo: "repo-a",
      startWith: "execute",
    });
  });

  it("scopes execute to the repository path", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Execute"));
    expect(mockStartAndNavigate).toHaveBeenCalledWith("execute", {
      workspace: "/ws/ws",
      repository: "github.com/acme/repo-a",
    });
  });
});

describe("RepoTodoCard collapsing", () => {
  const todoWithItems = makeTodo({
    items: [
      { text: "first item", status: "pending", indent: 0, children: [] },
    ],
    total: 1,
    pending: 1,
  });

  function toggle() {
    return screen.getByRole("button", { name: /repo-a/ });
  }

  it("starts collapsed, hiding the items and the update form", () => {
    renderCard(todoWithItems);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("first item")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Update TODOs for repo-a/),
    ).not.toBeInTheDocument();
  });

  it("keeps the counts and the per-repo actions reachable while collapsed", () => {
    renderCard(todoWithItems);
    expect(screen.getByText("0/1 done")).toBeInTheDocument();
    expect(screen.getByTitle("Autonomous")).toBeInTheDocument();
  });

  it("shows the items and the update form when the repo name is clicked", () => {
    renderCard(todoWithItems);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("first item")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Update TODOs for repo-a/),
    ).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    renderCard(todoWithItems);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("first item")).not.toBeInTheDocument();
  });
});
