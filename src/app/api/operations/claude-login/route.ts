import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildClaudeLoginPipeline } from "@/lib/pipelines/claude-login";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const phases = buildClaudeLoginPipeline();
    const operation = startOperationPipeline("claude-login", "claude-login", phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
