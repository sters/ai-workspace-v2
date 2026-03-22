import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the config module before importing the reader
vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/mock/workspace",
}));

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

import { quickSearchWorkspaces } from "@/lib/workspace/reader";

// Helper to mock Bun.file().text()
const originalBunFile = Bun.file;

function setupBunFileMock(contentMap: Record<string, string>) {
  Bun.file = ((path: string | URL | Bun.PathLike) => {
    const p = String(path);
    const content = contentMap[p];
    if (content !== undefined) {
      return {
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(content),
      };
    }
    return {
      exists: () => Promise.resolve(false),
      text: () => Promise.reject(new Error("not found")),
    };
  }) as unknown as typeof Bun.file;
}

describe("quickSearchWorkspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Bun.file = originalBunFile;
    mockStatSync.mockReturnValue({ mtime: new Date("2025-01-01T00:00:00Z") });
  });

  it("returns empty array when workspace dir does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const results = await quickSearchWorkspaces("test");
    expect(results).toEqual([]);
  });

  it("finds matching lines in README.md files", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === "/mock/workspace" || p === "/mock/workspace/ws1/README.md";
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "# My Project\nThis is a test workspace\nAnother line",
    });

    const results = await quickSearchWorkspaces("test");
    expect(results).toHaveLength(1);
    expect(results[0].workspaceName).toBe("ws1");
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0]).toEqual({
      lineNumber: 2,
      line: "This is a test workspace",
    });
  });

  it("performs case-insensitive matching", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === "/mock/workspace" || p === "/mock/workspace/ws1/README.md";
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "# Title\nSome TEXT here\nMore text",
    });

    const results = await quickSearchWorkspaces("text");
    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(2);
    expect(results[0].matches[0].line).toBe("Some TEXT here");
    expect(results[0].matches[1].line).toBe("More text");
  });

  it("returns empty results when no workspaces match", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === "/mock/workspace" || p === "/mock/workspace/ws1/README.md";
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "# Title\nNo matching content here",
    });

    const results = await quickSearchWorkspaces("nonexistent");
    expect(results).toEqual([]);
  });

  it("returns correct line numbers", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === "/mock/workspace" || p === "/mock/workspace/ws1/README.md";
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "line1\nline2\nmatch here\nline4\nmatch again",
    });

    const results = await quickSearchWorkspaces("match");
    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(2);
    expect(results[0].matches[0].lineNumber).toBe(3);
    expect(results[0].matches[1].lineNumber).toBe(5);
  });

  it("searches across multiple workspaces", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return (
        p === "/mock/workspace" ||
        p === "/mock/workspace/ws1/README.md" ||
        p === "/mock/workspace/ws2/README.md"
      );
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
      { name: "ws2", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "# WS1\nfoo bar",
      "/mock/workspace/ws2/README.md": "# WS2\nbaz foo",
    });

    const results = await quickSearchWorkspaces("foo");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.workspaceName).sort()).toEqual(["ws1", "ws2"]);
  });

  it("skips non-directory entries", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: "file.txt", isDirectory: () => false },
    ]);

    const results = await quickSearchWorkspaces("anything");
    expect(results).toEqual([]);
  });

  it("extracts title from README metadata", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === "/mock/workspace" || p === "/mock/workspace/ws1/README.md";
    });
    mockReaddirSync.mockReturnValue([
      { name: "ws1", isDirectory: () => true },
    ]);
    setupBunFileMock({
      "/mock/workspace/ws1/README.md": "# Task: My Cool Project\nSome searchable content",
    });

    const results = await quickSearchWorkspaces("searchable");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("My Cool Project");
  });
});
