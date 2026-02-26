import { NextResponse } from "next/server";
import { startOperationPipeline } from "@/lib/process-manager";
import { runClaudeLogin } from "@/lib/claude/login";

export async function POST() {
  const operation = startOperationPipeline("claude-login", "claude-login", [
    {
      kind: "function",
      label: "Claude Login",
      fn: async (ctx) => {
        return runClaudeLogin({
          emitStatus: ctx.emitStatus,
          signal: ctx.signal,
        });
      },
    },
  ]);

  return NextResponse.json(operation);
}
