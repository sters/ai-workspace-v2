import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OperationEvent, OperationListItem } from "@/types/operation";

const mockSummaries = vi.fn<() => OperationListItem[]>(() => []);
const mockEvents = vi.fn<(id: string) => OperationEvent[]>(() => []);
const mockReadLog = vi.fn();
const mockWorkspaceSummary = vi.fn();
const mockArchive = vi.fn();

vi.mock("@/lib/pipeline-manager", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOperationSummaries: () => mockSummaries(),
  getOperationEvents: (id: string) => mockEvents(id),
  getOperation: () => ({ phases: [{ index: 0, label: "Execute", status: "running" }] }),
}));
vi.mock("@/lib/operation-store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readOperationLog: (id: string) => mockReadLog(id),
}));
vi.mock("@/lib/workspace/reader", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getWorkspaceSummary: (name: string) => mockWorkspaceSummary(name),
}));
vi.mock("@/lib/workspace/archive", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  archiveWorkspaceWithPrs: (name: string, opts: unknown) => mockArchive(name, opts),
}));

import { handleMcpMessage } from "@/lib/mcp/protocol";
import { MCP_TOOLS } from "@/app/api/mcp/tools";

async function callTool(name: string, args: Record<string, unknown>) {
  const res = (await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    MCP_TOOLS,
  )) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = res.result.content[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // plain-text error message
  }
  return { data, isError: res.result.isError ?? false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSummaries.mockReturnValue([]);
  mockEvents.mockReturnValue([]);
});

describe("MCP tools", () => {
  it("lists every tool with an object input schema", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, MCP_TOOLS)) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    expect(res.result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["init_only", "autonomous", "execute", "review", "create_pr", "list_workspaces", "archive_workspace"]),
    );
    for (const tool of res.result.tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("get_operation reports a running operation's unanswered question with its toolUseId", async () => {
    mockSummaries.mockReturnValue([
      { id: "op-1", type: "execute", workspace: "ws", status: "running", startedAt: "2026-01-01T00:00:00Z", hasPendingAsk: true },
    ]);
    const ask = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu-1",
            name: "AskUserQuestion",
            input: { questions: [{ question: "Which DB?", header: "DB", options: [{ label: "MySQL", description: "" }], multiSelect: false }] },
          },
        ],
      },
    };
    mockEvents.mockReturnValue([
      { type: "output", operationId: "op-1", data: JSON.stringify(ask), timestamp: "t", childLabel: "repo" },
    ]);

    const { data, isError } = await callTool("get_operation", { operationId: "op-1" });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      status: "running",
      phases: [{ label: "Execute" }],
      pendingQuestion: { toolUseId: "tu-1", questions: [{ question: "Which DB?" }] },
    });
  });

  it("get_operation falls back to the stored log for a finished operation", async () => {
    mockReadLog.mockReturnValue({
      operation: { id: "op-2", type: "review", workspace: "ws", status: "completed", startedAt: "t" },
      events: [],
    });
    const { data, isError } = await callTool("get_operation", { operationId: "op-2" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ id: "op-2", status: "completed" });
  });

  it("list_operations leaves result bodies to get_operation and shortens long inputs", async () => {
    mockSummaries.mockReturnValue(
      Array.from({ length: 3 }, (_, i) => ({
        id: `op-${i}`,
        type: "autonomous" as const,
        workspace: "ws",
        status: "running" as const,
        startedAt: `2026-01-0${i + 1}T00:00:00Z`,
        inputs: { description: "x".repeat(5000) },
        resultSummary: { content: "long result" },
      })),
    );

    const { data } = await callTool("list_operations", { status: "running", limit: 2 });

    const ops = data as { id: string; inputs: { description: string }; resultSummary?: unknown }[];
    expect(ops).toHaveLength(2);
    expect(ops[0].resultSummary).toBeUndefined();
    expect(ops[0].inputs.description.length).toBeLessThan(500);
  });

  it("get_workspace lists each TODO item once, under its section", async () => {
    const item = { text: "Do it", status: "pending", indent: 0, children: [] };
    mockWorkspaceSummary.mockResolvedValue({
      name: "ws",
      todos: [{ filename: "TODO-repo.md", items: [item], sections: [{ heading: "Tasks", items: [item], notes: [] }] }],
    });

    const { data } = await callTool("get_workspace", { workspace: "ws" });

    const todo = (data as { todos: Record<string, unknown>[] }).todos[0];
    expect(todo.items).toBeUndefined();
    expect(todo.sections).toEqual([{ heading: "Tasks", items: [item], notes: [] }]);
  });

  it("get_operation carries the last status and error lines, which say why a run failed", async () => {
    const ev = (type: OperationEvent["type"], data: string, childLabel?: string): OperationEvent => ({
      type, operationId: "op-3", data, timestamp: "t", childLabel,
    });
    mockReadLog.mockReturnValue({
      operation: { id: "op-3", type: "autonomous", workspace: "ws", status: "failed", startedAt: "t" },
      events: [
        ev("status", "Phase 1/2: Execute", "Execute"),
        ev("output", JSON.stringify({ type: "assistant", message: { content: [] } })),
        ev("status", '__phaseUpdate:{"index":0}'),
        ev("error", "git push rejected", "repo"),
        ev("status", "Phase 1 failed, aborting pipeline"),
      ],
    });

    const { data } = await callTool("get_operation", { operationId: "op-3" });

    expect((data as { recentStatus: string[] }).recentStatus).toEqual([
      "Execute: Phase 1/2: Execute",
      "error: repo: git push rejected",
      "Phase 1 failed, aborting pipeline",
    ]);
  });

  it("get_operation is an error for an unknown id", async () => {
    mockReadLog.mockReturnValue(null);
    const { isError } = await callTool("get_operation", { operationId: "nope" });
    expect(isError).toBe(true);
  });

  it("archive_workspace refuses a workspace that does not exist", async () => {
    mockWorkspaceSummary.mockResolvedValue(null);
    const { isError } = await callTool("archive_workspace", { workspace: "missing" });
    expect(isError).toBe(true);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("archive_workspace archives by bare name even when given a path", async () => {
    mockWorkspaceSummary.mockResolvedValue({ name: "ws" });
    mockArchive.mockResolvedValue({ closed: [], warnings: [], harvest: { operationId: "op-9" } });
    const { data } = await callTool("archive_workspace", { workspace: "/root/workspace/ws" });
    expect(mockArchive).toHaveBeenCalledWith("ws", { closeOpenPrs: undefined });
    expect(data).toEqual({ workspace: "ws", archived: true, closed: [], warnings: [], harvest: { operationId: "op-9" } });
  });

  it("archive_workspace reports open PRs as an error instead of closing them unasked", async () => {
    const { OpenPullRequestsError } = await import("@/lib/workspace/archive");
    mockWorkspaceSummary.mockResolvedValue({ name: "ws" });
    const open = [{ repoName: "widgets", url: "https://github.com/acme/widgets/pull/7", title: "t" }];
    mockArchive.mockRejectedValue(new OpenPullRequestsError(open));
    const { data, isError } = await callTool("archive_workspace", { workspace: "ws" });
    expect(isError).toBe(true);
    expect(data).toMatchObject({ openPullRequests: open });
  });

  it("autonomous starts with init when startWith is omitted, like the web UI's default button", async () => {
    const { data, isError } = await callTool("autonomous", {});
    expect(isError).toBe(true);
    expect(data).toMatchObject({ error: expect.stringContaining("description is required") });
  });
});

describe("POST /api/mcp", () => {
  const post = async (body: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/mcp/route");
    return POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }));
  };

  it("answers a request with JSON", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("accepts a notification with 202 and no body", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("refuses a request from a non-local web origin", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { Origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("answers malformed JSON with a parse error", async () => {
    const res = await post("{not json");
    expect(await res.json()).toMatchObject({ error: { code: -32700 } });
  });
});
