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

let busyRepo: string | undefined;
vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    operations: [],
    isWorkspaceRunning: () => busyRepo !== undefined,
    isWorkspaceTypeRunning: () => false,
    isRepoBusy: (_ws: string, repo: string) => busyRepo !== undefined && repo === busyRepo,
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

import {
  ArchiveConfirm,
  OperationActions,
  WorkspaceManageButtons,
  useWorkspaceArchive,
} from "@/components/workspace/operation-panel";

function ManageButtons({
  workspaceName,
  archived,
  onArchived,
}: {
  workspaceName: string;
  workspacePath: string;
  archived?: boolean;
  onArchived?: () => void;
}) {
  const { archive, reportError } = useWorkspaceArchive(archived, () => onArchived?.());
  return (
    <>
      <WorkspaceManageButtons
        workspaceName={workspaceName}
        workspacePath="/tmp/ws"
        archived={archived}
        archive={onArchived ? archive : undefined}
        onArchiveError={reportError}
      />
      <ArchiveConfirm archive={archive} onError={reportError} />
    </>
  );
}

describe("OperationActions Create PR", () => {
  afterEach(() => {
    busyRepo = undefined;
  });

  it("keeps the repositories without a running operation selectable while the workspace is busy", async () => {
    busyRepo = "github.com/acme/widgets";
    render(
      <OperationActions
        workspaceName="ws"
        workspacePath="/tmp/ws"
        repositories={[
          { alias: "widgets", path: "github.com/acme/widgets" },
          { alias: "gadgets", path: "github.com/acme/gadgets" },
        ]}
      />,
    );

    const main = screen.getByRole("button", { name: /Create PR/ });
    expect(main).toBeDisabled();
    const dropdown = main.nextElementSibling as HTMLElement;
    expect(dropdown).toBeEnabled();

    await userEvent.click(dropdown);
    expect(screen.getByRole("menuitem", { name: "widgets" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "gadgets" })).toBeEnabled();
  });
});

describe("WorkspaceManageButtons archive button", () => {
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
      <ManageButtons
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
      <ManageButtons
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
      <ManageButtons
        workspaceName="ws-alpha"
        workspacePath="/tmp/ws"
        onArchived={onArchived}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("db locked", "error"));
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("lists open PRs and archives only after the close is confirmed", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "open PRs",
          openPullRequests: [{ repoName: "widgets", url: "https://github.com/acme/widgets/pull/7", title: "Add widgets" }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ archived: true }) });
    const onArchived = vi.fn();
    render(
      <ManageButtons workspaceName="ws-alpha" workspacePath="/tmp/ws" onArchived={onArchived} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
    expect(await screen.findByText(/Add widgets/)).toBeInTheDocument();
    expect(onArchived).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Close PRs and archive/ }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workspaces/ws-alpha/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeOpenPrs: true }),
    });
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it("drops the pending archive when cancelled", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "open PRs", openPullRequests: [{ repoName: "widgets", url: "u", title: "Add widgets" }] }),
    });
    render(<ManageButtons workspaceName="ws-alpha" workspacePath="/tmp/ws" onArchived={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Cancel$/ }));
    expect(screen.queryByText(/Add widgets/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits the archive button when no handler is given", () => {
    render(<ManageButtons workspaceName="ws-alpha" workspacePath="/tmp/ws" />);

    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete workspace/ })).toBeInTheDocument();
  });
});
