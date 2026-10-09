import { vi, describe, it, expect } from "vitest";

// Mock dependencies to avoid bun:sqlite bundling issues
vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
  getConfig: () => ({ claude: { path: null } }),
}));

vi.mock("@/lib/pty", () => ({
  spawnTerminal: vi.fn(),
}));

const { parseMcpToolsFromInitEvent } = await import("@/lib/claude/mcp");

describe("parseMcpToolsFromInitEvent", () => {
  it("extracts MCP tools grouped by server name", () => {
    const tools = [
      "Bash", "Read", "Edit",
      "mcp__github__create_issue",
      "mcp__github__list_repos",
      "mcp__filesystem__read_file",
      "mcp__filesystem__write_file",
      "mcp__filesystem__list_directory",
    ];

    const result = parseMcpToolsFromInitEvent(tools);

    expect(result).toEqual([
      { name: "github", tools: ["create_issue", "list_repos"] },
      { name: "filesystem", tools: ["read_file", "write_file", "list_directory"] },
    ]);
  });

  it("returns empty array when no MCP tools exist", () => {
    const tools = ["Bash", "Read", "Edit", "Write", "StructuredOutput"];
    expect(parseMcpToolsFromInitEvent(tools)).toEqual([]);
  });

  it("ignores malformed mcp__ entries without double underscore separator", () => {
    const tools = ["mcp__badformat", "mcp__github__valid_tool"];
    const result = parseMcpToolsFromInitEvent(tools);
    expect(result).toEqual([
      { name: "github", tools: ["valid_tool"] },
    ]);
  });

  it("preserves order of servers and tools", () => {
    const tools = [
      "mcp__beta__z_tool",
      "mcp__alpha__a_tool",
      "mcp__beta__a_tool",
      "mcp__alpha__z_tool",
    ];
    const result = parseMcpToolsFromInitEvent(tools);
    expect(result).toEqual([
      { name: "beta", tools: ["z_tool", "a_tool"] },
      { name: "alpha", tools: ["a_tool", "z_tool"] },
    ]);
  });
});
