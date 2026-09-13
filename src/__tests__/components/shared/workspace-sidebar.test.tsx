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
    operations: { id?: string; hasPendingAsk?: boolean; workspace: string }[];
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
      operations: [{ id: "op-1", workspace: "ws-ask", hasPendingAsk: true }],
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

  it("opens the running operation straight from its indicator", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws-ask"]),
      operations: [{ id: "op-42", workspace: "ws-ask", hasPendingAsk: true }],
    });
    mockWorkspaces([makeWorkspace("ws-ask", "Asking")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Waiting for an answer")).toHaveAttribute(
      "href",
      "/workspace/ws-ask/operations?operationId=op-42",
    );
  });

  it("links the asking operation rather than another running one", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws"]),
      operations: [
        { id: "op-quiet", workspace: "ws" },
        { id: "op-asking", workspace: "ws", hasPendingAsk: true },
      ],
    });
    mockWorkspaces([makeWorkspace("ws", "Both")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Waiting for an answer")).toHaveAttribute(
      "href",
      "/workspace/ws/operations?operationId=op-asking",
    );
  });

  it("falls back to the operations tab when no operation id is known", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws-run"]),
      operations: [],
    });
    mockWorkspaces([makeWorkspace("ws-run", "Running")]);
    render(<WorkspaceSidebar />);

    expect(screen.getByLabelText("Operation running")).toHaveAttribute(
      "href",
      "/workspace/ws-run/operations",
    );
  });

  it("opens the chat straight from its indicator", () => {
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([["ws chat", "busy"]]),
    });
    mockWorkspaces([makeWorkspace("ws chat", "Spaced name")]);
    render(<WorkspaceSidebar />);

    // The chat tab has no index route — `/chat` alone is a 404.
    expect(screen.getByLabelText("Chat working")).toHaveAttribute(
      "href",
      "/workspace/ws%20chat/chat/interactive",
    );
  });

  it("keeps the row itself a link to the workspace", () => {
    mockUseRunningOperations.mockReturnValue({
      runningWorkspaces: new Set(["ws"]),
      operations: [{ id: "op-1", workspace: "ws" }],
    });
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([["ws", "busy"]]),
    });
    mockWorkspaces([makeWorkspace("ws", "Alpha Project")]);
    render(<WorkspaceSidebar />);

    // An <a> inside an <a> is invalid and browsers drop the inner one, so the
    // row's link is an overlay named by the title rather than a wrapper.
    expect(screen.getByRole("link", { name: "Alpha Project" })).toHaveAttribute(
      "href",
      "/workspace/ws",
    );
  });

  it("flags workspaces with a chat session by what the chat is doing", () => {
    mockUseChatSessions.mockReturnValue({
      chatActivity: new Map<string, ChatActivity>([
        ["ws-busy", "busy"],
        ["ws-waiting", "waiting"],
      ]),
    });
    // Titles kept clear of the indicator labels: the row's own overlay link is
    // named by the title, so a workspace called "Chat working" matches both.
    mockWorkspaces([
      makeWorkspace("ws-none", "Untouched"),
      makeWorkspace("ws-busy", "Busy one"),
      makeWorkspace("ws-waiting", "Idle one"),
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
