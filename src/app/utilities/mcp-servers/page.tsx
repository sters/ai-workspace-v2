"use client";

import useSWR from "swr";

type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: Record<string, unknown>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const scopeColors: Record<string, string> = {
  user: "bg-blue-100 text-blue-800",
  project: "bg-green-100 text-green-800",
  local: "bg-yellow-100 text-yellow-800",
};

function getServerType(config: Record<string, unknown>): string {
  if (config.type === "sse") return "sse";
  if (config.type === "http") return "http";
  return "stdio";
}

export default function McpServersPage() {
  const { data, error, isLoading } = useSWR<{ servers: McpServerEntry[] }>(
    "/api/mcp-servers",
    fetcher
  );

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">MCP Servers</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        MCP servers configured for Claude Code across user, project, and local
        scopes.
      </p>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="text-sm text-destructive">Failed to load MCP servers.</p>
      )}

      {data && data.servers.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No MCP servers configured. Add servers to{" "}
            <code className="text-xs">~/.claude/settings.json</code> or your
            project&apos;s <code className="text-xs">.claude/settings.json</code>{" "}
            to see them here.
          </p>
        </div>
      )}

      {data && data.servers.length > 0 && (
        <div className="grid gap-3">
          {data.servers.map((server, i) => (
            <ServerCard key={`${server.scope}-${server.name}-${i}`} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerCard({ server }: { server: McpServerEntry }) {
  const type = getServerType(server.config);
  const env = server.config.env as Record<string, string> | undefined;
  const headers = server.config.headers as Record<string, string> | undefined;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{server.name}</h2>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${scopeColors[server.scope] ?? ""}`}
        >
          {server.scope}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {type}
        </span>
      </div>

      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        {type === "stdio" && (
          <p>
            <span className="font-medium text-foreground">command:</span>{" "}
            <code className="text-xs">
              {String(server.config.command ?? "")}
              {Array.isArray(server.config.args) &&
                server.config.args.length > 0 &&
                ` ${(server.config.args as string[]).join(" ")}`}
            </code>
          </p>
        )}
        {(type === "sse" || type === "http") && (
          <p>
            <span className="font-medium text-foreground">url:</span>{" "}
            <code className="text-xs">{String(server.config.url ?? "")}</code>
          </p>
        )}

        {env && Object.keys(env).length > 0 && (
          <p>
            <span className="font-medium text-foreground">env:</span>{" "}
            {Object.keys(env).map((k) => (
              <code key={k} className="mr-1 text-xs">
                {k}=***
              </code>
            ))}
          </p>
        )}

        {headers && Object.keys(headers).length > 0 && (
          <p>
            <span className="font-medium text-foreground">headers:</span>{" "}
            {Object.keys(headers).map((k) => (
              <code key={k} className="mr-1 text-xs">
                {k}: ***
              </code>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
