import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ArtifactEntry, ArtifactFileContent } from "@/types/artifact";

const mockReplace = vi.fn();
const mockUseArtifacts = vi.fn();
const mockUseArtifactFile = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/hooks/use-workspace", () => ({
  useArtifacts: (...args: unknown[]) => mockUseArtifacts(...args),
  useArtifactFile: (...args: unknown[]) => mockUseArtifactFile(...args),
}));

import { ArtifactsBrowser } from "@/components/workspace/artifacts-browser";

function entry(path: string, overrides: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    path,
    name: path.split("/").pop()!,
    depth: path.split("/").length - 1,
    isDir: false,
    size: 10,
    modifiedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function dir(path: string): ArtifactEntry {
  return entry(path, { isDir: true, size: 0 });
}

function setListing(entries: ArtifactEntry[], truncated = false) {
  mockUseArtifacts.mockReturnValue({
    entries,
    truncated,
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  });
}

function setFile(file: ArtifactFileContent | undefined) {
  mockUseArtifactFile.mockReturnValue({ file, isLoading: false, error: undefined });
}

function makeFile(overrides: Partial<ArtifactFileContent> = {}): ArtifactFileContent {
  return {
    path: "known-findings.md",
    size: 20,
    modifiedAt: 1_700_000_000_000,
    kind: "markdown",
    content: "# Known Findings",
    truncated: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockReplace.mockReset();
  mockUseArtifacts.mockReset();
  mockUseArtifactFile.mockReset();
  searchParams = new URLSearchParams();
  setListing([]);
  setFile(undefined);
});

describe("ArtifactsBrowser listing", () => {
  it("says so when the workspace has no artifacts", () => {
    render(<ArtifactsBrowser workspaceName="ws" />);
    expect(screen.getByText(/no artifacts/i)).toBeInTheDocument();
  });

  it("expands top-level directories and leaves nested ones collapsed", () => {
    setListing([
      dir("reviews"),
      dir("reviews/20260101-000000"),
      entry("reviews/20260101-000000/SUMMARY.md"),
      entry("known-findings.md"),
    ]);

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText("reviews")).toBeInTheDocument();
    expect(screen.getByText("20260101-000000")).toBeInTheDocument();
    expect(screen.getByText("known-findings.md")).toBeInTheDocument();
    expect(screen.queryByText("SUMMARY.md")).not.toBeInTheDocument();
  });

  it("reveals a nested directory's files when it is clicked", () => {
    setListing([
      dir("reviews"),
      dir("reviews/20260101-000000"),
      entry("reviews/20260101-000000/SUMMARY.md"),
    ]);

    render(<ArtifactsBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByText("20260101-000000"));

    expect(screen.getByText("SUMMARY.md")).toBeInTheDocument();
  });

  it("hides a top-level directory's children when it is collapsed", () => {
    setListing([dir("research"), entry("research/summary.md")]);

    render(<ArtifactsBrowser workspaceName="ws" />);
    expect(screen.getByText("summary.md")).toBeInTheDocument();

    fireEvent.click(screen.getByText("research"));
    expect(screen.queryByText("summary.md")).not.toBeInTheDocument();
  });

  it("keeps the end of a long name on screen, since review files differ only there", () => {
    const long = "CONSTRAINTS-github.com_acme_admin-graphql-jp.md";
    setListing([entry(long)]);

    render(<ArtifactsBrowser workspaceName="ws" />);
    const row = screen.getByTitle(long);

    // The name is split so the head truncates and the distinguishing tail does not.
    expect(row.querySelector(".truncate")?.textContent).not.toContain("graphql-jp.md");
    expect(row.textContent).toContain(long);
  });

  it("puts the clicked file in the url so a reload and a link both land on it", () => {
    setListing([entry("known-findings.md")]);

    render(<ArtifactsBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByText("known-findings.md"));

    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/ws/artifacts?file=known-findings.md",
      { scroll: false },
    );
  });

  it("expands the ancestors of a file named in the url", () => {
    searchParams = new URLSearchParams({ file: "reviews/20260101-000000/SUMMARY.md" });
    setListing([
      dir("reviews"),
      dir("reviews/20260101-000000"),
      entry("reviews/20260101-000000/SUMMARY.md"),
    ]);
    setFile(makeFile({ path: "reviews/20260101-000000/SUMMARY.md" }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText("SUMMARY.md")).toBeInTheDocument();
  });

  it("reports an incomplete listing rather than presenting it as the whole directory", () => {
    setListing([entry("a.md")], true);

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText(/too many files/i)).toBeInTheDocument();
  });
});

describe("ArtifactsBrowser viewer", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ file: "known-findings.md" });
    setListing([entry("known-findings.md")]);
  });

  it("renders a markdown artifact", () => {
    setFile(makeFile({ content: "# Known Findings" }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(
      screen.getByRole("heading", { name: "Known Findings" }),
    ).toBeInTheDocument();
  });

  it("shows markdown source when asked", () => {
    setFile(makeFile({ content: "# Known Findings" }));

    render(<ArtifactsBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));

    expect(screen.getByText("# Known Findings")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Known Findings" }),
    ).not.toBeInTheDocument();
  });

  it("pretty-prints json", () => {
    setFile(makeFile({ path: "pr-validations.json", kind: "json", content: '{"a":1}' }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it("shows unparsable json as it stands rather than failing", () => {
    setFile(makeFile({ path: "broken.json", kind: "json", content: "{not json" }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText("{not json")).toBeInTheDocument();
  });

  it("names a binary artifact instead of rendering it", () => {
    setFile(makeFile({ path: "shot.png", kind: "binary", content: "", size: 2048 }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText(/not a text file/i).textContent).toContain("2.0 KB");
  });

  it("says a large artifact is cut short", () => {
    setFile(makeFile({ truncated: true, size: 900_000 }));

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText(/first 512\.0 KB/i)).toBeInTheDocument();
  });

  it("reports a file the server would not read", () => {
    mockUseArtifactFile.mockReturnValue({
      file: undefined,
      isLoading: false,
      error: new Error("HTTP 404"),
    });

    render(<ArtifactsBrowser workspaceName="ws" />);

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
  });
});
