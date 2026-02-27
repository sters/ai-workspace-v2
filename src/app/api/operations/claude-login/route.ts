import { NextResponse } from "next/server";
import { startOperationPipeline } from "@/lib/pipeline-manager";
import { buildClaudeLoginPipeline } from "@/lib/pipelines/claude-login";

export async function POST() {
  const phases = buildClaudeLoginPipeline();
  const operation = startOperationPipeline("claude-login", "claude-login", phases);
  return NextResponse.json(operation);
}
