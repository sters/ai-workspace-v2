import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetClaudeVersion = vi.fn();
vi.mock("@/lib/claude/version", () => ({
  getClaudeVersion: () => mockGetClaudeVersion(),
}));

beforeEach(() => {
  mockGetClaudeVersion.mockReset();
});

describe("GET /api/claude-version", () => {
  it("returns version string on success", async () => {
    mockGetClaudeVersion.mockReturnValue("claude-code 1.0.20 (Claude Code)");

    const { GET } = await import("@/app/api/claude-version/route");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.version).toBe("claude-code 1.0.20 (Claude Code)");
  });

  it("returns error when getClaudeVersion throws", async () => {
    mockGetClaudeVersion.mockImplementation(() => {
      throw new Error("command not found");
    });

    const { GET } = await import("@/app/api/claude-version/route");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toContain("command not found");
  });
});
