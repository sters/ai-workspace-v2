import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import type { RepoChangeSet } from "@/types/changes";

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockUseChanges = vi.fn();
const mockUseDiff = vi.fn();
const mockStart = vi.fn();
let runningTypes: string[] = [];
let searchParams = new URLSearchParams();
// The comments live in a module-level cache per workspace, so each test gets its own.
let ws = "";
let wsCount = 0;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspaceChanges: (...args: unknown[]) => mockUseChanges(...args),
  useWorkspaceChangeDiff: (...args: unknown[]) => mockUseDiff(...args),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => mockStart,
}));

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => ({
    isWorkspaceRunning: () => runningTypes.length > 0,
    isWorkspaceTypeRunning: (_ws: string, type: string) => runningTypes.includes(type),
  }),
}));

// Monaco does not run in jsdom. The stand-in hands over a fixed selection when
// clicked, which is what the real viewer does once the user selects lines, and
// renders each zone with the lines it sits under.
vi.mock("@/components/shared/content/unified-diff-viewer", () => ({
  UnifiedDiffViewer: ({
    onSelectLines,
    zones,
  }: {
    onSelectLines?: (r: unknown) => void;
    zones?: { key: string; fromLine: number; toLine: number; content: React.ReactNode }[];
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onSelectLines?.({ oldRange: [4, 4], newRange: [4, 5], text: "-a\n+b\n+c" })}
      >
        select lines
      </button>
      {zones?.map((z) => (
        <section key={z.key} aria-label={`under lines ${z.fromLine}-${z.toLine}`}>
          {z.content}
        </section>
      ))}
    </div>
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

const scrolledTo = vi.fn();

beforeEach(() => {
  // jsdom lays nothing out, so nothing scrolls by itself; this records what was scrolled to.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledTo(this);
  };
  scrolledTo.mockReset();
  mockReplace.mockReset();
  mockPush.mockReset();
  mockStart.mockReset();
  mockStart.mockResolvedValue(true);
  runningTypes = [];
  ws = `ws-${++wsCount}`;
  sessionStorage.clear();
  searchParams = new URLSearchParams();
  mockUseChanges.mockReturnValue({ repos: [WEB, API], isLoading: false, error: undefined, refresh: vi.fn() });
  mockUseDiff.mockClear();
  mockUseDiff.mockReturnValue({
    diff: { diff: "@@ -4,1 +4,2 @@\n-a\n+b\n+c\n", truncated: false },
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fileSection(path: string): HTMLElement {
  return screen.getByRole("region", { name: path });
}

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
    expect(within(groupOf("web")).queryByText("app.ts")).not.toBeInTheDocument();
    expect(within(groupOf("api")).getByText(/could not be compared/)).toBeInTheDocument();
  });

  it("lists every changed file's diff in the tree's order, with nothing selected", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    // The tree puts directories before files, so `src/lib/` comes before `src/app.ts`.
    const names = screen
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label"))
      .filter((n) => !n?.startsWith("under lines"));
    expect(names).toEqual(["src/lib/util.ts", "src/app.ts"]);
    expect(within(fileSection("src/app.ts")).getByRole("button", { name: "select lines" })).toBeInTheDocument();
  });

  it("reads a file's diff only once its section nears the visible part of the list", () => {
    const observed = new Map<Element, (entries: { isIntersecting: boolean }[]) => void>();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
        observe(el: Element) {
          observed.set(el, this.cb);
        }
        disconnect() {}
      },
    );
    mockUseDiff.mockReturnValue({ diff: undefined, isLoading: false, error: undefined, refresh: vi.fn() });
    render(<ChangesBrowser workspaceName="ws" />);

    const requested = () => mockUseDiff.mock.calls.map((c) => c[2]).filter((p) => p !== null);
    expect(requested()).toEqual([]);

    act(() => observed.get(fileSection("src/app.ts"))!([{ isIntersecting: true }]));

    expect(new Set(requested())).toEqual(new Set(["src/app.ts"]));
  });

  it("scrolls the list to a file clicked in the tree, and keeps it in the URL", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    fireEvent.click(screen.getByText("util.ts"));
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/ws/changes?repo=github.com%2Facme%2Fweb&file=src%2Flib%2Futil.ts",
      { scroll: false },
    );
    expect(scrolledTo).toHaveBeenLastCalledWith(fileSection("src/lib/util.ts").parentElement);
  });

  it("scrolls the tree along with the list, so the file being read stays in view", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    render(<ChangesBrowser workspaceName="ws" />);

    const rect = (el: Element, top: number, height: number) =>
      (el.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect);
    const scrollable = (el: HTMLElement) => {
      Object.defineProperty(el, "scrollHeight", { value: 1000 });
      Object.defineProperty(el, "clientHeight", { value: 200 });
    };

    const tree = screen.getByRole("navigation", { name: "Changed files" });
    scrollable(tree);
    rect(tree, 0, 200);
    const treeScroll = vi.fn();
    tree.scrollBy = treeScroll;
    rect(screen.getByText("util.ts").closest("button")!, 40, 20);
    // Below the part of the tree that is on screen.
    rect(screen.getByText("app.ts").closest("button")!, 500, 20);

    const list = screen.getByText(/Select lines in a diff/).parentElement!;
    scrollable(list);
    rect(list, 0, 200);
    rect(fileSection("src/lib/util.ts").parentElement!, -800, 700);
    rect(fileSection("src/app.ts").parentElement!, 0, 700);
    fireEvent.scroll(list);

    expect(screen.getByText("app.ts").closest("button")).toHaveAttribute("aria-current", "true");
    expect(treeScroll).toHaveBeenCalledTimes(1);
    // The row is brought to the middle of the tree: 500 - (200 - 20) / 2.
    expect(treeScroll).toHaveBeenCalledWith({ top: 410 });

    // A row already on screen leaves the tree where the reader put it.
    rect(fileSection("src/lib/util.ts").parentElement!, 0, 700);
    rect(fileSection("src/app.ts").parentElement!, 700, 700);
    fireEvent.scroll(list);
    expect(screen.getByText("util.ts").closest("button")).toHaveAttribute("aria-current", "true");
    expect(treeScroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls to a linked file when the page opens", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName="ws" />);

    expect(scrolledTo).toHaveBeenCalledTimes(1);
    expect(scrolledTo).toHaveBeenCalledWith(fileSection("src/app.ts").parentElement);
  });

  it("collapses one file's diff without touching the others", () => {
    render(<ChangesBrowser workspaceName="ws" />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse src/app.ts" }));

    expect(within(fileSection("src/app.ts")).queryByRole("button", { name: "select lines" })).not.toBeInTheDocument();
    expect(within(fileSection("src/lib/util.ts")).getByRole("button", { name: "select lines" })).toBeInTheDocument();
  });

  function comment(text: string) {
    fireEvent.click(within(fileSection("src/app.ts")).getByRole("button", { name: "select lines" }));
    const box = screen.getByPlaceholderText(/leave a comment/i);
    fireEvent.change(box, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
  }

  it("shows a comment under the lines it was made on, and lets it be edited in place", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);

    comment("Why two lines?");

    // Editor lines 2-4: the hunk header is line 1.
    const zone = within(screen.getByRole("region", { name: "under lines 2-4" }));
    expect(zone.getByText("Why two lines?")).toBeInTheDocument();
    expect(screen.getByText("1 comment")).toBeInTheDocument();

    fireEvent.click(zone.getByRole("button", { name: "Edit" }));
    fireEvent.change(zone.getByDisplayValue("Why two lines?"), { target: { value: "Merge them." } });
    fireEvent.click(zone.getByRole("button", { name: "Save" }));
    expect(zone.getByText("Merge them.")).toBeInTheDocument();
  });

  it("does not place a comment on lines that changed since it was made", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    const { rerender } = render(<ChangesBrowser workspaceName={ws} />);
    comment("Why two lines?");

    mockUseDiff.mockReturnValue({
      diff: { diff: "@@ -4,1 +4,2 @@\n-a\n+b\n+changed\n", truncated: false },
      isLoading: false,
      error: undefined,
      refresh: vi.fn(),
    });
    rerender(<ChangesBrowser workspaceName={ws} />);

    expect(screen.queryByRole("region", { name: /under lines/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer match/)).toBeInTheDocument();
    // Still in the list, so it can still be handed over or removed.
    expect(screen.getByText("1 comment")).toBeInTheDocument();
  });

  it("opens a chat whose first message is every comment with its lines", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);

    comment("Why two lines?");
    comment("");
    expect(screen.getByText("2 comments")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /talk in chat/i }));

    expect(mockPush).toHaveBeenCalledWith(`/workspace/${ws}/chat/interactive`);
    const topic = peekChatHandoff(ws)?.discussion ?? "";
    expect(topic).toContain("1. github.com/acme/web/src/app.ts, lines 4-5");
    expect(topic).toContain("My comment: Why two lines?");
    expect(topic).toContain("2. github.com/acme/web/src/app.ts, lines 4-5");
    // Handed over, so the list starts empty next time.
    expect(screen.queryByText(/\d comments?$/)).not.toBeInTheDocument();
  });

  it("plans the comments and runs them through autonomous, in the one repository they are in", async () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);
    comment("Merge the two lines.");

    fireEvent.click(screen.getByRole("button", { name: /make todos/i }));

    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());
    const [type, body] = mockStart.mock.calls[0];
    expect(type).toBe("autonomous");
    expect(body.startWith).toBe("update-todo");
    expect(body.repo).toBe("github.com/acme/web");
    expect(body.instruction).toContain("`TODO-web.md`");
    expect(body.instruction).toContain("Merge the two lines.");
    await vi.waitFor(() => expect(screen.queryByText("1 comment")).not.toBeInTheDocument());
  });

  it("keeps the comments when the TODO run is refused", async () => {
    mockStart.mockResolvedValue(false);
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);
    comment("Merge the two lines.");

    fireEvent.click(screen.getByRole("button", { name: /make todos/i }));

    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(screen.getByText("1 comment")).toBeInTheDocument();
  });

  it("does not start a run over a workspace another operation is editing", () => {
    runningTypes = ["review"];
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);
    comment("Merge the two lines.");

    expect(screen.getByRole("button", { name: /make todos/i })).toBeDisabled();
  });

  it("asks for a comment on every selection before making TODOs of them", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    render(<ChangesBrowser workspaceName={ws} />);
    comment("Merge the two lines.");
    comment("");

    expect(screen.getByRole("button", { name: /make todos/i })).toBeDisabled();
    expect(screen.getByText(/1 has no comment/)).toBeInTheDocument();
  });

  it("keeps comments across a remount", () => {
    searchParams = new URLSearchParams({ repo: "github.com/acme/web", file: "src/app.ts" });
    const first = render(<ChangesBrowser workspaceName={ws} />);
    comment("Why?");
    first.unmount();

    render(<ChangesBrowser workspaceName={ws} />);
    expect(screen.getByText("1 comment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.queryByText("1 comment")).not.toBeInTheDocument();
  });
});
