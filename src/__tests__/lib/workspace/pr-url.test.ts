import { describe, expect, it, vi, beforeEach } from "vitest";
import { extractPrUrls } from "@/lib/workspace/pr-url";
import type { PrUrlInfo } from "@/lib/workspace/pr-url";

vi.mock("@/lib/workspace/helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/workspace/helpers")>();
  return {
    ...mod,
    exec: vi.fn(),
  };
});

describe("extractPrUrls", () => {
  it("extracts a single PR URL", () => {
    const text = "Please review https://github.com/sters/ai-workspace-v2/pull/42";
    const result = extractPrUrls(text);
    expect(result).toEqual([
      {
        url: "https://github.com/sters/ai-workspace-v2/pull/42",
        owner: "sters",
        repo: "ai-workspace-v2",
        repoPath: "github.com/sters/ai-workspace-v2",
        prNumber: 42,
      },
    ]);
  });

  it("extracts multiple PR URLs", () => {
    const text = [
      "Frontend: https://github.com/sters/ai-workspace-v2/pull/10",
      "Backend: https://github.com/sters/other-repo/pull/20",
    ].join("\n");
    const result = extractPrUrls(text);
    expect(result).toHaveLength(2);
    expect(result[0].repoPath).toBe("github.com/sters/ai-workspace-v2");
    expect(result[0].prNumber).toBe(10);
    expect(result[1].repoPath).toBe("github.com/sters/other-repo");
    expect(result[1].prNumber).toBe(20);
  });

  it("returns empty array when no PR URLs", () => {
    expect(extractPrUrls("just some text")).toEqual([]);
    expect(extractPrUrls("")).toEqual([]);
  });

  it("ignores GitHub issue URLs", () => {
    const text = "See https://github.com/sters/ai-workspace-v2/issues/42";
    expect(extractPrUrls(text)).toEqual([]);
  });

  it("ignores non-GitHub URLs", () => {
    const text = "See https://gitlab.com/sters/ai-workspace-v2/merge_requests/42";
    expect(extractPrUrls(text)).toEqual([]);
  });

  it("builds repoPath in github.com/owner/repo format", () => {
    const text = "https://github.com/sters/ai-workspace-v2/pull/1";
    const result = extractPrUrls(text);
    expect(result[0].repoPath).toBe("github.com/sters/ai-workspace-v2");
  });

  it("deduplicates same PR URL appearing multiple times", () => {
    const text = [
      "https://github.com/sters/ai-workspace-v2/pull/42",
      "same PR: https://github.com/sters/ai-workspace-v2/pull/42",
    ].join("\n");
    const result = extractPrUrls(text);
    expect(result).toHaveLength(1);
  });
});

describe("resolvePrBranch", () => {
  const mockPrUrl: PrUrlInfo = {
    url: "https://github.com/sters/ai-workspace-v2/pull/42",
    owner: "sters",
    repo: "ai-workspace-v2",
    repoPath: "github.com/sters/ai-workspace-v2",
    prNumber: 42,
  };

  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const helpers = await import("@/lib/workspace/helpers");
    mockExec = helpers.exec as ReturnType<typeof vi.fn>;
    mockExec.mockReset();
  });

  it("returns head and base branch info", async () => {
    const { resolvePrBranch } = await import("@/lib/workspace/pr-url");
    mockExec.mockReturnValue(
      JSON.stringify({
        headRefName: "feature/new-widget",
        baseRefName: "main",
        headRepositoryOwner: { login: "sters" },
      }),
    );

    const result = resolvePrBranch(mockPrUrl);
    expect(result).toEqual({
      headBranch: "feature/new-widget",
      baseBranch: "main",
      repoPath: "github.com/sters/ai-workspace-v2",
      prUrl: "https://github.com/sters/ai-workspace-v2/pull/42",
      isFork: false,
    });
  });

  it("detects fork PRs", async () => {
    const { resolvePrBranch } = await import("@/lib/workspace/pr-url");
    mockExec.mockReturnValue(
      JSON.stringify({
        headRefName: "fork-branch",
        baseRefName: "main",
        headRepositoryOwner: { login: "contributor" },
      }),
    );

    const result = resolvePrBranch(mockPrUrl);
    expect(result.isFork).toBe(true);
    expect(result.headBranch).toBe("fork-branch");
  });

  it("throws when gh command fails", async () => {
    const { resolvePrBranch } = await import("@/lib/workspace/pr-url");
    mockExec.mockImplementation(() => {
      throw new Error("gh: command not found");
    });

    expect(() => resolvePrBranch(mockPrUrl)).toThrow("gh: command not found");
  });
});
