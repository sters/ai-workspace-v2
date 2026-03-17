import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkspaceSummary } from "@/types/workspace";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockUseWorkspaces = vi.fn<() => {
  workspaces: WorkspaceSummary[];
  isLoading: boolean;
  error: Error | undefined;
}>();
vi.mock("@/hooks/use-workspaces", () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

const mockUseRunningOperations = vi.fn<() => { runningWorkspaces: Set<string>; operations: { hasPendingAsk?: boolean; workspace: string }[] }>();
vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => mockUseRunningOperations(),
}));

// Import after mocks
import { WorkspaceList } from "@/components/dashboard/workspace-list";

function makeWorkspace(name: string, title: string): WorkspaceSummary {
  return {
    name,
    path: `/tmp/${name}`,
    meta: {
      title,
      taskType: "feature",
      ticketId: "TICK-1",
      date: "2025-01-01",
      repositories: [{ alias: "r", path: "/r", baseBranch: "main" }],
    },
    todos: [],
    overallProgress: 50,
    totalCompleted: 1,
    totalItems: 2,
    lastModified: "2025-01-02",
  };
}

describe("WorkspaceList", () => {
  beforeEach(() => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set<string>(),
      operations: [],
    });
  });

  it("renders loading skeleton", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [],
      isLoading: true,
      error: undefined,
    });
    const { container } = render(<WorkspaceList />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders error state", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [],
      isLoading: false,
      error: new Error("fail"),
    });
    render(<WorkspaceList />);
    expect(screen.getByText("Failed to load workspaces.")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [],
      isLoading: false,
      error: undefined,
    });
    render(<WorkspaceList />);
    expect(screen.getByText(/No workspaces found/)).toBeInTheDocument();
  });

  it("renders workspaces as cards", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [
        makeWorkspace("ws-alpha", "Alpha Project"),
        makeWorkspace("ws-beta", "Beta Project"),
      ],
      isLoading: false,
      error: undefined,
    });
    render(<WorkspaceList />);
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Beta Project")).toBeInTheDocument();
  });

  it("renders each workspace as a link", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [makeWorkspace("ws-1", "WS One")],
      isLoading: false,
      error: undefined,
    });
    render(<WorkspaceList />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/workspace/ws-1");
  });
});
