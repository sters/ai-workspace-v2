import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AI_WORKSPACE_ROOT } from "@/lib/config";

type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: McpServerConfig;
};

async function readMcpServersFromFile(
  filePath: string,
  scope: McpServerEntry["scope"]
): Promise<McpServerEntry[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    const mcpServers = data.mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") return [];

    return Object.entries(mcpServers).map(([name, config]) => ({
      name,
      scope,
      config: config as McpServerConfig,
    }));
  } catch {
    return [];
  }
}

async function readLocalMcpServers(): Promise<McpServerEntry[]> {
  // Claude Code stores per-project local MCP servers in
  // ~/.claude.json under projects[projectPath].mcpServers
  try {
    const content = await fs.readFile(
      path.join(os.homedir(), ".claude.json"),
      "utf-8"
    );
    const data = JSON.parse(content);
    const projects = data.projects;
    if (!projects || typeof projects !== "object") return [];

    // AI_WORKSPACE_ROOT may be relative; resolve to absolute to match the key
    const absRoot = path.resolve(AI_WORKSPACE_ROOT);
    const projectConfig = projects[absRoot];
    if (!projectConfig?.mcpServers) return [];

    const mcpServers = projectConfig.mcpServers;
    return Object.entries(mcpServers).map(([name, config]) => ({
      name,
      scope: "local" as const,
      config: config as McpServerConfig,
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const [projectServers, localServers] = await Promise.all([
    // Project scope: .mcp.json at project root
    readMcpServersFromFile(
      path.join(AI_WORKSPACE_ROOT, ".mcp.json"),
      "project"
    ),
    // Local scope: ~/.claude.json projects[path].mcpServers
    readLocalMcpServers(),
  ]);

  return NextResponse.json({
    servers: [...projectServers, ...localServers],
  });
}
