import path from "node:path";
import os from "node:os";
import { spawnClaude, spawnClaudeSync } from "./cli";
import { getResolvedWorkspaceRoot } from "../config";
import type {
  McpAuthStatus,
  McpConnectionStatus,
  McpServerConfig,
  McpServerEntry,
  McpServerTools,
  McpSSEServerConfig,
  McpStdioServerConfig,
  McpHttpServerConfig,
  StreamEvent,
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

// ---------------------------------------------------------------------------
// MCP tool listing (parsed from system init event's tools array)
// ---------------------------------------------------------------------------

/**
 * Extract MCP tools from the `system` init event's `tools` array.
 * MCP tools follow the naming convention `mcp__{serverName}__{toolName}`.
 * Groups them by server name.
 */
export function parseMcpToolsFromInitEvent(tools: string[]): McpServerTools[] {
  const serverMap = new Map<string, string[]>();

  for (const tool of tools) {
    if (!tool.startsWith("mcp__")) continue;
    // mcp__{serverName}__{toolName}
    const rest = tool.slice(5); // remove "mcp__"
    const sep = rest.indexOf("__");
    if (sep === -1) continue;
    const serverName = rest.slice(0, sep);
    const toolName = rest.slice(sep + 2);
    if (!serverMap.has(serverName)) {
      serverMap.set(serverName, []);
    }
    serverMap.get(serverName)!.push(toolName);
  }

  return Array.from(serverMap.entries()).map(([name, toolNames]) => ({
    name,
    tools: toolNames,
  }));
}

/**
 * Spawn `claude -p` with a minimal prompt, read the system init event,
 * and extract MCP tool names from the tools array.
 * Kills the process as soon as the init event is found to avoid wasting tokens.
 */
export async function getMcpTools(): Promise<McpServerTools[]> {
  const proc = spawnClaude({
    args: [
      "-p", "-",
      "--output-format", "stream-json",
      "--verbose",
      "--model", "haiku",
    ],
    stdin: "pipe",
  });

  // Send a trivial prompt — we only need the system init event
  if (proc.stdin) {
    proc.stdin.write("Say OK");
    proc.stdin.end();
  }

  // Stream stdout incrementally and kill as soon as init event is found
  try {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const result = Bun.JSONL.parseChunk(buffer);
      if (result.read > 0) {
        buffer = buffer.slice(result.read);
      }

      for (const parsed of result.values as StreamEvent[]) {
        if (parsed.type === "system" && parsed.subtype === "init" && Array.isArray(parsed.tools)) {
          proc.kill();
          return parseMcpToolsFromInitEvent(parsed.tools);
        }
      }
    }
  } catch {
    // Process may have been killed
  }

  return [];
}
