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

async function readMcpServers(
  filePath: string,
  scope: McpServerEntry["scope"]
): Promise<McpServerEntry[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const settings = JSON.parse(content);
    const mcpServers = settings.mcpServers;
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

export async function GET() {
  const sources: { path: string; scope: McpServerEntry["scope"] }[] = [
    {
      path: path.join(os.homedir(), ".claude", "settings.json"),
      scope: "user",
    },
    {
      path: path.join(AI_WORKSPACE_ROOT, ".claude", "settings.json"),
      scope: "project",
    },
    {
      path: path.join(AI_WORKSPACE_ROOT, ".claude", "settings.local.json"),
      scope: "local",
    },
  ];

  const results = await Promise.all(
    sources.map((s) => readMcpServers(s.path, s.scope))
  );

  return NextResponse.json({ servers: results.flat() });
}
