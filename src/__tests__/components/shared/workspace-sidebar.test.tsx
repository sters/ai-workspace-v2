import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkspaceListItem } from "@/types/workspace";

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

const mockPathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

const mockUseWorkspaces = vi.fn<
  () => {
    workspaces: WorkspaceListItem[];
    olderCount: number;
    archivedCount: number;
    isLoading: boolean;
    error: Error | undefined;
    refresh: () => void;
  }
>();
vi.mock("@/hooks/use-workspaces", () => ({
  useWorkspaces: (opts?: unknown) => mockUseWorkspaces(opts as never),
}));

const mockUseRunningOperations = vi.fn<
  () => {
    runningWorkspaces: Set<string>;
    operations: { hasPendingAsk?: boolean; workspace: string }[];
  }
>();
vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => mockUseRunningOperations(),
}));

type ChatActivity = "busy" | "waiting" | "unknown";

const mockUseChatSessions = vi.fn<
  () => { chatActivity: Map<string, ChatActivity> }
>();
vi.mock("@/hooks/use-chat-sessions", () => ({
  useChatSessions: () => mockUseChatSessions(),
}));

// Import after mocks
import { WorkspaceSidebar } from "@/components/shared/workspace-sidebar";

function makeWorkspace(
  name: string,
  title: string,
  extra: Partial<WorkspaceListItem> = {},
): WorkspaceListItem {
  return {
    name,
    title,
    taskType: "feature",
    ticketId: "",
    date: "2026-01-01",
    repoCount: 1,
    overallProgress: 50,
    totalCompleted: 1,
    totalItems: 2,
    lastModified: new Date().toISOString(),
    ...extra,
  };
}

function mockWorkspaces(
  workspaces: WorkspaceListItem[],
  counts: { olderCount?: number; archivedCount?: number } = {},
) {
  mockUseWorkspaces.mockReturnValue({
    workspaces,
    olderCount: counts.olderCount ?? 0,
    archivedCount: counts.archivedCount ?? 0,
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  });
}

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/");
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set<string>(),
      operations: [],
    });
    mockUseChatSessions.mockReturnValue({ chatActivity: new Map() });
  });

  it("lists each workspace as a link to its page", () => {
    mockWorkspaces([
      makeWorkspace("ws-alpha", "Alpha Project"),
      makeWorkspace("ws-beta", "Beta Project"),
    ]);
    render(<WorkspaceSidebar />);

    expect(screen.getByRole("link", { name: /Alpha Project/ })).toHaveAttribute(
      "href",
      "/workspace/ws-alpha",
    );
    expect(screen.getByRole("link", { name: /Beta Project/ })).toHaveAttribute(
      "href",
      "/workspace/ws-beta",
    );
  });

  it("marks the workspace of the current route as current", () => {
    mockPathname.mockReturnValue("/workspace/ws-beta/todo");
    mockWorkspaces([
      makeWorkspace("ws-alpha", "Alpha Project"),
      makeWorkspace("ws-beta", "Beta Project"),
    ]);
    render(<WorkspaceSidebar />);

    expect(screen.getByRole("link", { name: /Beta Project/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: /Alpha Project/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("matches the active workspace through a URL-encoded path segment", () => {
    mockPathname.mockReturnValue("/workspace/fix%20login");
    mockWorkspaces([makeWorkspace("fix login", "Fix login")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByRole("link", { name: /Fix login/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("flags running and asking workspaces", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws-run", "ws-ask"]),
      operations: [{ workspace: "ws-ask", hasPendingAsk: true }],
    });
    mockWorkspaces([
      makeWorkspace("ws-idle", "Idle"),
      makeWorkspace("ws-run", "Running"),
      makeWorkspace("ws-ask", "Asking"),
    ]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Operation running")).toBeInTheDocument();
    expect(screen.getByLabelText("Waiting for an answer")).toBeInTheDocument();
  });

  it("flags workspaces with a chat session by what the chat is doing", () => {
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([
        ["ws-busy", "busy"],
        ["ws-waiting", "waiting"],
      ]),
    });
    mockWorkspaces([
      makeWorkspace("ws-none", "No chat"),
      makeWorkspace("ws-busy", "Chat working"),
      makeWorkspace("ws-waiting", "Chat idle"),
    ]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Chat working")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat waiting for input")).toBeInTheDocument();
  });

  it("shows the operation and chat indicators side by side", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws-both"]),
      operations: [],
    });
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([["ws-both", "busy"]]),
    });
    mockWorkspaces([makeWorkspace("ws-both", "Both")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Operation running")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat working")).toBeInTheDocument();
  });

  it("claims only that the chat is open when its activity is unknown", () => {
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([["ws-old", "unknown"]]),
    });
    mockWorkspaces([makeWorkspace("ws-old", "Old chat server")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Chat open")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Chat waiting for input"),
    ).not.toBeInTheDocument();
  });

  it("says nothing about chat for a workspace with no session", () => {
    mockWorkspaces([makeWorkspace("ws-none", "No chat")]);
    render(<WorkspaceSidebar />);

    expect(screen.queryByLabelText(/^Chat /)).not.toBeInTheDocument();
  });

  it("reveals older workspaces on demand", async () => {
    const user = userEvent.setup();
    mockWorkspaces([makeWorkspace("ws-1", "One")], { olderCount: 4 });
    render(<WorkspaceSidebar />);

    await user.click(screen.getByRole("button", { name: /4 older/i }));
    expect(mockUseWorkspaces).toHaveBeenLastCalledWith({
      recentOnly: false,
      includeArchived: false,
    });
  });

  it("reveals archived workspaces on demand", async () => {
    const user = userEvent.setup();
    mockWorkspaces([makeWorkspace("ws-1", "One")], { archivedCount: 2 });
    render(<WorkspaceSidebar />);

    await user.click(screen.getByRole("button", { name: /2 archived/i }));
    expect(mockUseWorkspaces).toHaveBeenLastCalledWith({
      recentOnly: false,
      includeArchived: true,
    });
  });

  it("requests only recent workspaces by default", () => {
    mockWorkspaces([makeWorkspace("ws-1", "One")]);
    render(<WorkspaceSidebar />);
    expect(mockUseWorkspaces).toHaveBeenCalledWith({
      recentOnly: true,
      includeArchived: false,
    });
  });

  it("renders an empty state", () => {
    mockWorkspaces([]);
    render(<WorkspaceSidebar />);
    expect(screen.getByText(/No workspaces/i)).toBeInTheDocument();
  });

  it("renders an error state", () => {
    mockUseWorkspaces.mockReturnValue({
      workspaces: [],
      olderCount: 0,
      archivedCount: 0,
      isLoading: false,
      error: new Error("boom"),
      refresh: vi.fn(),
    });
    render(<WorkspaceSidebar />);
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });
});
