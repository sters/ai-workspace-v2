import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/workspace-root",
}));

const mockGetMcpTools = vi.fn();

vi.mock("@/lib/claude/mcp", () => ({
  getMcpTools: () => mockGetMcpTools(),
}));

async function callGET() {
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.doMock("@/lib/config", () => ({
    getResolvedWorkspaceRoot: () => "/workspace-root",
  }));
  vi.doMock("@/lib/claude/mcp", () => ({
    getMcpTools: () => mockGetMcpTools(),
  }));

  const mod = await import("@/app/api/mcp-servers/tools/route");
  const response = await mod.GET();
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  mockGetMcpTools.mockReset();
});

describe("GET /api/mcp-servers/tools", () => {
  it("returns tools from getMcpTools", async () => {
    mockGetMcpTools.mockResolvedValue([
      { name: "github", tools: ["create_issue", "list_repos"] },
      { name: "filesystem", tools: ["read_file"] },
    ]);

    const { status, body } = await callGET();
    expect(status).toBe(200);
    expect(body.tools).toEqual([
      { name: "github", tools: ["create_issue", "list_repos"] },
      { name: "filesystem", tools: ["read_file"] },
    ]);
  });

  it("returns empty tools array on error", async () => {
    mockGetMcpTools.mockRejectedValue(new Error("spawn failed"));

    const { status, body } = await callGET();
    expect(status).toBe(500);
    expect(body.tools).toEqual([]);
    expect(body.error).toContain("spawn failed");
  });

  it("returns empty array when no tools available", async () => {
    mockGetMcpTools.mockResolvedValue([]);

    const { status, body } = await callGET();
    expect(status).toBe(200);
    expect(body.tools).toEqual([]);
  });
});
