import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...(actual as Record<string, unknown>),
    default: { ...(actual as Record<string, unknown>), homedir: () => "/mock-home" },
    homedir: () => "/mock-home",
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

async function callPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/mcp-servers/route");
  const request = new NextRequest("http://localhost:3741/api/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await mod.POST(request);
  return response.json();
}

beforeEach(() => {
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
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
      authStatus: { hasAuth: false, authType: "none", keyCount: 0 },
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
      authStatus: { hasAuth: false, authType: "none", keyCount: 0 },
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
      authStatus: { hasAuth: true, authType: "env", keyCount: 1 },
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

  it("returns authStatus with headers for http/sse servers", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            github: {
              type: "sse",
              url: "https://mcp.github.com/sse",
              headers: { Authorization: "Bearer token123" },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers[0].authStatus).toEqual({
      hasAuth: true,
      authType: "headers",
      keyCount: 1,
    });
  });

  it("returns authStatus with env for stdio servers", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            myserver: {
              command: "node",
              args: ["server.js"],
              env: { API_KEY: "secret", DB_URL: "postgres://..." },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers[0].authStatus).toEqual({
      hasAuth: true,
      authType: "env",
      keyCount: 2,
    });
  });

  it("returns authStatus none for http server without headers", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            plain: { type: "http", url: "https://example.com/mcp" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers[0].authStatus).toEqual({
      hasAuth: false,
      authType: "none",
      keyCount: 0,
    });
  });

  it("returns authStatus with multiple headers", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            multi: {
              type: "http",
              url: "https://example.com",
              headers: {
                Authorization: "Bearer abc",
                "X-Api-Key": "key123",
                "X-Custom": "value",
              },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const data = await callGET();
    expect(data.servers[0].authStatus).toEqual({
      hasAuth: true,
      authType: "headers",
      keyCount: 3,
    });
  });
});

describe("POST /api/mcp-servers", () => {
  it("saves headers to project .mcp.json", async () => {
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
    mockWriteFile.mockResolvedValue(undefined);

    const data = await callPOST({
      serverName: "github",
      scope: "project",
      updates: { headers: { Authorization: "Bearer token" } },
    });

    expect(data.ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const [writePath, writeContent] = mockWriteFile.mock.calls[0];
    expect(writePath).toContain(".mcp.json");
    const written = JSON.parse(writeContent);
    expect(written.mcpServers.github.headers).toEqual({
      Authorization: "Bearer token",
    });
    // Original fields preserved
    expect(written.mcpServers.github.url).toBe(
      "https://mcp.github.com/sse"
    );
  });

  it("saves env to project .mcp.json for stdio server", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            myserver: { command: "node", args: ["server.js"] },
          },
        });
      }
      throw new Error("ENOENT");
    });
    mockWriteFile.mockResolvedValue(undefined);

    const data = await callPOST({
      serverName: "myserver",
      scope: "project",
      updates: { env: { API_KEY: "secret123" } },
    });

    expect(data.ok).toBe(true);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(written.mcpServers.myserver.env).toEqual({
      API_KEY: "secret123",
    });
  });

  it("saves headers to local ~/.claude.json", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude.json")) {
        return JSON.stringify({
          numStartups: 5,
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
    mockWriteFile.mockResolvedValue(undefined);

    const data = await callPOST({
      serverName: "atlassian",
      scope: "local",
      updates: { headers: { Authorization: "Bearer atlassian-token" } },
    });

    expect(data.ok).toBe(true);
    const [writePath, writeContent] = mockWriteFile.mock.calls[0];
    expect(writePath).toContain(".claude.json");
    const written = JSON.parse(writeContent);
    // Preserves other top-level keys
    expect(written.numStartups).toBe(5);
    expect(
      written.projects["/workspace-root"].mcpServers.atlassian.headers
    ).toEqual({ Authorization: "Bearer atlassian-token" });
  });

  it("removes empty headers/env from config", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            github: {
              type: "sse",
              url: "https://mcp.github.com/sse",
              headers: { Authorization: "Bearer old" },
            },
          },
        });
      }
      throw new Error("ENOENT");
    });
    mockWriteFile.mockResolvedValue(undefined);

    const data = await callPOST({
      serverName: "github",
      scope: "project",
      updates: { headers: {} },
    });

    expect(data.ok).toBe(true);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(written.mcpServers.github.headers).toBeUndefined();
  });

  it("returns error for unknown server", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return JSON.stringify({ mcpServers: {} });
      }
      throw new Error("ENOENT");
    });

    const data = await callPOST({
      serverName: "nonexistent",
      scope: "project",
      updates: { headers: { Authorization: "Bearer token" } },
    });

    expect(data.error).toBeDefined();
  });

  it("returns error for invalid scope", async () => {
    const data = await callPOST({
      serverName: "github",
      scope: "invalid",
      updates: { headers: {} },
    });

    expect(data.error).toBeDefined();
  });
});
