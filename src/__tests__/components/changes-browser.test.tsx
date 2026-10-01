import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RepoChangeSet } from "@/types/changes";

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockUseChanges = vi.fn();
const mockUseDiff = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspaceChanges: (...args: unknown[]) => mockUseChanges(...args),
  useWorkspaceChangeDiff: (...args: unknown[]) => mockUseDiff(...args),
}));

// Monaco does not run in jsdom. The stand-in hands over a fixed selection when
// clicked, which is what the real viewer does once the user selects lines.
vi.mock("@/components/shared/content/unified-diff-viewer", () => ({
  UnifiedDiffViewer: ({ onSelectLines }: { onSelectLines?: (r: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSelectLines?.({ oldRange: [4, 4], newRange: [4, 5], text: "-a\n+b\n+c" })}
    >
      select lines
    </button>
  ),
}));

import { ChangesBrowser } from "@/components/workspace/changes-browser";
import { peekChatHandoff } from "@/lib/chat-handoff";

const WEB: RepoChangeSet = {
  repoPath: "github.com/acme/web",
  repoName: "web",
  baseBranch: "main",
  baseSha: "abc",
  files: [
    { path: "src/app.ts", status: "modified", additions: 2, deletions: 1 },
    { path: "src/lib/util.ts", status: "added", additions: 5, deletions: 0 },
  ],
};

const API: RepoChangeSet = {
  repoPath: "github.com/acme/api",
  repoName: "api",
  baseBranch: "master",
  baseSha: null,
  files: [],
  error: "origin/master could not be compared with HEAD",
};

beforeEach(() => {
  mockReplace.mockReset();
  mockPush.mockReset();
  sessionStorage.clear();
  searchParams = new URLSearchParams();
  mockUseChanges.mockReturnValue({ repos: [WEB, API], isLoading: false, error: undefined, refresh: vi.fn() });
  mockUseDiff.mockReturnValue({
    diff: { diff: "@@ -1,1 +1,1 @@\n-a\n+b\n", truncated: false },
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  });
});

function groupOf(repoName: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${repoName}`) }).parentElement!;
}

describe("ChangesBrowser", () => {
  it("groups each repository's files, and says why a repository has none", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    const web = within(groupOf("web"));
    expect(web.getByText("app.ts")).toBeInTheDocument();
    expect(web.getByText("util.ts")).toBeInTheDocument();
    expect(within(groupOf("api")).getByText(/could not be compared/)).toBeInTheDocument();
  });

  it("collapses one repository without touching the others", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    fireEvent.click(screen.getByRole("button", { name: /^web/ }));
    expect(screen.queryByText("app.ts")).not.toBeInTheDocument();
    expect(screen.getByText(/could not be compared/)).toBeInTheDocument();
  });

  it("selects a file by repository and path in the URL", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    fireEvent.click(screen.getByText("util.ts"));
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/ws/changes?repo=github.com%2Facme%2Fweb&file=src%2Flib%2Futil.ts",
      { scroll: false },
    );
  });

  it("collects selections and hands them to the chat as one draft", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName="ws" />);

    fireEvent.click(screen.getByRole("button", { name: "select lines" }));
    fireEvent.click(screen.getByRole("button", { name: "select lines" }));
    expect(screen.getByText("2 selections for the chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /talk in chat/i }));

    expect(mockPush).toHaveBeenCalledWith("/workspace/ws/chat/interactive");
    const draft = peekChatHandoff("ws")?.draft ?? "";
    expect(draft).toContain("1. github.com/acme/web/src/app.ts, lines 4-5");
    expect(draft).toContain("2. github.com/acme/web/src/app.ts, lines 4-5");
    // Handed over, so the tray starts empty next time.
    expect(screen.queryByText(/selections? for the chat/)).not.toBeInTheDocument();
  });

  it("keeps collected selections across a remount", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    const first = render(<ChangesBrowser workspaceName="ws-keep" />);
    fireEvent.click(screen.getByRole("button", { name: "select lines" }));
    first.unmount();

    render(<ChangesBrowser workspaceName="ws-keep" />);
    expect(screen.getByText("1 selection for the chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.queryByText(/selection for the chat/)).not.toBeInTheDocument();
  });
});
