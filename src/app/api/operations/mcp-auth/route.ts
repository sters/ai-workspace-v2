import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
import { runMcpAuthSession } from "@/lib/mcp-auth";
import { mcpAuthSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(mcpAuthSchema, body);
  if (!parsed.success) return parsed.response;

  const { serverName, forceReauth } = parsed.data;
  const isReauth = forceReauth === true || forceReauth === "true";

  try {
    const operation = startOperationPipeline("mcp-auth", `mcp:${serverName}`, [
      {
        kind: "function",
        label: `Authenticate ${serverName}`,
        fn: async (ctx) => {
          return runMcpAuthSession(
            serverName,
            {
              emitStatus: ctx.emitStatus,
              emitTerminal: ctx.emitTerminal,
              signal: ctx.signal,
            },
            { forceReauth: isReauth },
          );
        },
      },
    ]);

    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
