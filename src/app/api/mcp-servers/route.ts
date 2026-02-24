import { NextRequest, NextResponse } from "next/server";
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

type AuthStatus = {
  hasAuth: boolean;
  authType: "env" | "headers" | "none";
  keyCount: number;
};

type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: McpServerConfig;
  authStatus: AuthStatus;
};

function computeAuthStatus(config: McpServerConfig): AuthStatus {
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
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    const mcpServers = data.mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") return [];

    return Object.entries(mcpServers).map(([name, config]) => {
      const cfg = config as McpServerConfig;
      return {
        name,
        scope,
        config: cfg,
        authStatus: computeAuthStatus(cfg),
      };
    });
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
    return Object.entries(mcpServers).map(([name, config]) => {
      const cfg = config as McpServerConfig;
      return {
        name,
        scope: "local" as const,
        config: cfg,
        authStatus: computeAuthStatus(cfg),
      };
    });
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverName, scope, updates } = body as {
      serverName: string;
      scope: string;
      updates: { env?: Record<string, string>; headers?: Record<string, string> };
    };

    if (scope !== "project" && scope !== "local") {
      return NextResponse.json(
        { error: "Invalid scope. Must be 'project' or 'local'." },
        { status: 400 }
      );
    }

    if (scope === "project") {
      const filePath = path.join(AI_WORKSPACE_ROOT, ".mcp.json");
      const data = JSON.parse(await fs.readFile(filePath, "utf-8"));
      if (!data.mcpServers?.[serverName]) {
        return NextResponse.json(
          { error: `Server '${serverName}' not found in .mcp.json` },
          { status: 404 }
        );
      }
      applyUpdates(data.mcpServers[serverName], updates);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } else {
      // local scope → ~/.claude.json
      const filePath = path.join(os.homedir(), ".claude.json");
      const data = JSON.parse(await fs.readFile(filePath, "utf-8"));
      const absRoot = path.resolve(AI_WORKSPACE_ROOT);
      if (!data.projects?.[absRoot]?.mcpServers?.[serverName]) {
        return NextResponse.json(
          { error: `Server '${serverName}' not found in local config` },
          { status: 404 }
        );
      }
      applyUpdates(data.projects[absRoot].mcpServers[serverName], updates);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

function applyUpdates(
  config: Record<string, unknown>,
  updates: { env?: Record<string, string>; headers?: Record<string, string> }
) {
  if (updates.env !== undefined) {
    if (Object.keys(updates.env).length === 0) {
      delete config.env;
    } else {
      config.env = updates.env;
    }
  }
  if (updates.headers !== undefined) {
    if (Object.keys(updates.headers).length === 0) {
      delete config.headers;
    } else {
      config.headers = updates.headers;
    }
  }
}
