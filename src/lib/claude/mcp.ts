import path from "node:path";
import os from "node:os";
import { spawnClaudeSync } from "./cli";
import { getResolvedWorkspaceRoot } from "../config";
import type {
  McpAuthStatus,
  McpConnectionStatus,
  McpServerConfig,
  McpServerEntry,
  McpSSEServerConfig,
  McpStdioServerConfig,
  McpHttpServerConfig,
} from "@/types/claude";
import { mcpFileSchema, mcpServerConfigSchema, claudeJsonProjectSchema } from "../runtime-schemas";

function computeAuthStatus(config: McpServerConfig): McpAuthStatus {
  const type = config.type ?? "stdio";
  if (type === "sse" || type === "http") {
    const headers = (config as McpSSEServerConfig | McpHttpServerConfig)
      .headers;
    const keyCount = headers ? Object.keys(headers).length : 0;
    return {
      hasAuth: keyCount > 0,
      authType: keyCount > 0 ? "headers" : "none",
      keyCount,
    };
  }
  // stdio
  const env = (config as McpStdioServerConfig).env;
  const keyCount = env ? Object.keys(env).length : 0;
  return {
    hasAuth: keyCount > 0,
    authType: keyCount > 0 ? "env" : "none",
    keyCount,
  };
}

async function readMcpServersFromFile(
  filePath: string,
  scope: McpServerEntry["scope"]
): Promise<McpServerEntry[]> {
  try {
    const content = await Bun.file(filePath).text();
    const fileResult = mcpFileSchema.safeParse(JSON.parse(content));
    if (!fileResult.success) return [];

    return Object.entries(fileResult.data.mcpServers).flatMap(([name, raw]) => {
      const cfgResult = mcpServerConfigSchema.safeParse(raw);
      if (!cfgResult.success) return [];
      const cfg = cfgResult.data as McpServerConfig;
      return [{ name, scope, config: cfg, authStatus: computeAuthStatus(cfg) }];
    });
  } catch {
    return [];
  }
}

async function readLocalMcpServers(): Promise<McpServerEntry[]> {
  // Claude Code stores per-project local MCP servers in
  // ~/.claude.json under projects[projectPath].mcpServers
  try {
    const content = await Bun.file(
      path.join(os.homedir(), ".claude.json")
    ).text();
    const data = JSON.parse(content);
    const projects = data.projects;
    if (!projects || typeof projects !== "object") return [];

    // getResolvedWorkspaceRoot() may be relative; resolve to absolute to match the key
    const absRoot = path.resolve(getResolvedWorkspaceRoot());
    const projectConfig = projects[absRoot];
    const projResult = claudeJsonProjectSchema.safeParse(projectConfig);
    if (!projResult.success) return [];

    return Object.entries(projResult.data.mcpServers).flatMap(([name, raw]) => {
      const cfgResult = mcpServerConfigSchema.safeParse(raw);
      if (!cfgResult.success) return [];
      const cfg = cfgResult.data as McpServerConfig;
      return [{ name, scope: "local" as const, config: cfg, authStatus: computeAuthStatus(cfg) }];
    });
  } catch {
    return [];
  }
}

/** Read MCP server configs from project .mcp.json and local ~/.claude.json. */
export async function readMcpServers(): Promise<McpServerEntry[]> {
  const [projectServers, localServers] = await Promise.all([
    readMcpServersFromFile(
      path.join(getResolvedWorkspaceRoot(), ".mcp.json"),
      "project"
    ),
    readLocalMcpServers(),
  ]);
  return [...projectServers, ...localServers];
}

// ---------------------------------------------------------------------------
// MCP connection status (via `claude mcp list`)
// ---------------------------------------------------------------------------

/**
 * Parse `claude mcp list` output to get real connection status.
 *
 * Example output:
 *   atlassian: https://mcp.atlassian.com/v1/mcp (HTTP) - ! Needs authentication
 *   github: https://mcp.github.com/sse (SSE) - ✓ Connected
 *   filesystem: npx -y @modelcontextprotocol/server-filesystem (stdio) - ✓ Connected
 */
export function parseClaudeMcpList(output: string): McpConnectionStatus[] {
  const results: McpConnectionStatus[] = [];
  for (const line of output.split("\n")) {
    // Match: name: ... - status
    const match = line.match(/^(\S+):\s.+\s-\s(.+)$/);
    if (!match) continue;

    const name = match[1];
    const statusText = match[2].trim();

    let status: McpConnectionStatus["status"] = "unknown";
    const lower = statusText.toLowerCase();
    if (lower.includes("needs authentication") || lower.includes("auth")) {
      status = "needs_auth";
    } else if (lower.includes("connected") || statusText.startsWith("✓")) {
      status = "ok";
    } else if (lower.includes("error") || lower.includes("failed") || statusText.startsWith("✗")) {
      status = "error";
    }

    results.push({ name, status, statusText });
  }
  return results;
}

/** Run `claude mcp list` and return parsed connection statuses. */
export function getMcpStatuses(): McpConnectionStatus[] {
  const result = spawnClaudeSync({ args: ["mcp", "list"] });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || "claude mcp list failed");
  }
  return parseClaudeMcpList(result.stdout.toString());
}
