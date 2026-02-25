import { NextResponse } from "next/server";
import { startOperationPipeline } from "@/lib/process-manager";
import { runMcpAuthSession } from "@/lib/mcp-auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { serverName, forceReauth } = body as {
    serverName: string;
    forceReauth?: boolean | string;
  };
  const isReauth = forceReauth === true || forceReauth === "true";

  if (!serverName) {
    return NextResponse.json(
      { error: "serverName is required" },
      { status: 400 }
    );
  }

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
}
