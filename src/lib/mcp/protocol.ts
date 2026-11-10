import z from "zod";
import pkg from "../../../package.json";

/**
 * Stateless MCP over Streamable HTTP: every POST carries one JSON-RPC message
 * and gets a plain JSON answer, so there is no session and no SSE stream. Only
 * the `tools` capability is offered.
 */

export interface McpTool {
  name: string;
  description: string;
  input: z.ZodType;
  /** Receives the arguments already parsed by `input`. */
  call(args: unknown): Promise<{ data: unknown; isError?: boolean }>;
}

/** Newest first; the first entry is offered when the client asks for an unknown version. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = [
  "Drives ai-workspace, a manager of multi-repository workspaces whose operations run Claude Code in the background.",
  "To start a new task, call autonomous with its description: it creates the workspace and carries the task through to pull requests.",
  "Tools that start an operation (autonomous, init_only, update_todo, execute, review, create_pr) return at once with the operation's id.",
  "Follow it with get_operation until its status is no longer `running`; when it reports a pendingQuestion, the operation is blocked until answer_question is called.",
].join(" ");

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const callParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

type Id = string | number | null;

function success(id: Id, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function failure(id: Id, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function toolResult(data: unknown, isError: boolean) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
}

async function callTool(tool: McpTool, rawArgs: unknown) {
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return toolResult(parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "), true);
  }
  try {
    const { data, isError } = await tool.call(parsed.data);
    return toolResult(data, isError ?? false);
  } catch (err) {
    return toolResult(err instanceof Error ? err.message : String(err), true);
  }
}

/** Returns the JSON-RPC response, or `null` for a notification, which gets none. */
export async function handleMcpMessage(message: unknown, tools: McpTool[]): Promise<object | null> {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return failure(null, -32600, "Invalid JSON-RPC request");
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return success(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "ai-workspace", version: pkg.version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return success(id, {});
    case "tools/list":
      return success(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input, { io: "input" }),
        })),
      });
    case "tools/call": {
      const call = callParamsSchema.safeParse(params);
      if (!call.success) return failure(id, -32602, "tools/call needs a tool name");
      const tool = tools.find((t) => t.name === call.data.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${call.data.name}`);
      return success(id, await callTool(tool, call.data.arguments));
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Guards against DNS rebinding: a web page may POST here from the browser,
 * which always sends its Origin, while MCP clients such as the Claude CLI send none.
 */
export function isLocalOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
