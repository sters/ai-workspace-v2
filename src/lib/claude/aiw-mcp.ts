import { getConfig } from "@/lib/config";

/**
 * `--mcp-config` for this server's own MCP endpoint, so an agent can list
 * workspaces and start operations. The flag takes any number of values: keep
 * another flag after it, or the CLI reads what follows as more configs.
 */
export function aiwMcpConfigArgs(): string[] {
  return [
    "--mcp-config",
    JSON.stringify({
      mcpServers: { "ai-workspace": { type: "http", url: `http://localhost:${getConfig().server.port}/api/mcp` } },
    }),
  ];
}
