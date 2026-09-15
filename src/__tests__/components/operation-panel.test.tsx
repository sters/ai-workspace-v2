import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    operations: [],
    isWorkspaceRunning: () => false,
    isWorkspaceTypeRunning: () => false,
  }),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-openers", () => ({
  useOpeners: () => ({ openers: [], isLoading: false, error: undefined }),
}));

const mockShowToast = vi.fn();
vi.mock("@/components/shared/feedback/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

// Import after mocks
import { OperationPanel } from "@/components/workspace/operation-panel";

describe("OperationPanel archive button", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockShowToast.mockClear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ archived: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the archive route and reports back when clicked", async () => {
    const onArchived = vi.fn();
    render(
      <OperationPanel
        workspaceName="ws alpha"
        workspacePath="/tmp/ws"
        onArchived={onArchived}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws%20alpha/archive", {
      method: "POST",
    });
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("offers to unarchive an archived workspace", () => {
    render(
      <OperationPanel
        workspaceName="ws-alpha"
        workspacePath="/tmp/ws"
        archived
        onArchived={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Unarchive/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Archive$/ })).not.toBeInTheDocument();
  });

  it("toasts and does not report back when the request fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "db locked" }),
    });
    const onArchived = vi.fn();
    render(
      <OperationPanel
        workspaceName="ws-alpha"
        workspacePath="/tmp/ws"
        onArchived={onArchived}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("db locked", "error"));
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("omits the archive button when no handler is given", () => {
    render(<OperationPanel workspaceName="ws-alpha" workspacePath="/tmp/ws" />);

    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete workspace/ })).toBeInTheDocument();
  });
});
