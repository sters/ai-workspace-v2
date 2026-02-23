import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: { readFile: (...args: unknown[]) => mockReadFile(...args) },
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    default: { ...actual.default, homedir: () => "/mock-home" },
  };
});

vi.mock("@/lib/config", () => ({
  AI_WORKSPACE_ROOT: "/workspace-root",
}));

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/mcp-servers/route");
  const response = await mod.GET();
  return response.json();
}

beforeEach(() => {
  mockReadFile.mockReset();
});

describe("GET /api/mcp-servers", () => {
  it("returns local MCP servers from ~/.claude.json projects", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          projects: {
            "/workspace-root": {
              mcpServers: {
                atlassian: {
                  type: "http",
                  url: "https://mcp.atlassian.com/v1/mcp",
                },
              },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toEqual({
      name: "atlassian",
      scope: "local",
      config: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" },
    });
  });

  it("returns project MCP servers from .mcp.json", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            github: { type: "sse", url: "https://mcp.github.com/sse" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toEqual({
      name: "github",
      scope: "project",
      config: { type: "sse", url: "https://mcp.github.com/sse" },
    });
  });

  it("returns servers from both sources combined", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            github: { type: "sse", url: "https://mcp.github.com/sse" },
          },
        });
      }
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          projects: {
            "/workspace-root": {
              mcpServers: {
                atlassian: {
                  type: "http",
                  url: "https://mcp.atlassian.com/v1/mcp",
                },
              },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toHaveLength(2);
    const names = data.servers.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["atlassian", "github"]);
  });

  it("returns empty when no config files exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const data = await callGET();
    expect(data.servers).toEqual([]);
  });

  it("returns empty when ~/.claude.json has no projects key", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({ numStartups: 5 });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toEqual([]);
  });

  it("returns empty when project exists but has no mcpServers", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          projects: {
            "/workspace-root": { allowedTools: [] },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toEqual([]);
  });

  it("returns empty when project mcpServers is empty object", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          projects: {
            "/workspace-root": { mcpServers: {} },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toEqual([]);
  });

  it("handles stdio server config from .mcp.json", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
              env: { LOG_LEVEL: "info" },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toEqual({
      name: "filesystem",
      scope: "project",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { LOG_LEVEL: "info" },
      },
    });
  });

  it("ignores unrelated projects in ~/.claude.json", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          projects: {
            "/other-project": {
              mcpServers: {
                slack: { type: "http", url: "https://mcp.slack.com" },
              },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers).toEqual([]);
  });
});
