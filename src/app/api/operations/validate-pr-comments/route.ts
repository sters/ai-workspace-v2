import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildValidatePrCommentsPipeline } from "@/lib/pipelines/validate-pr-comments";
import { validatePrCommentsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(validatePrCommentsSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  // Duplicates would spawn two children for one thread, and the second write
  // would just overwrite the first.
  const threadIds = [...new Set(parsed.data.threadIds)];

  try {
    const phases = buildValidatePrCommentsPipeline({ workspace, threadIds });
    const operation = startOperationPipeline(
      "validate-pr-comments",
      workspace,
      phases,
      undefined,
      { threadIds: threadIds.join(","), threadCount: String(threadIds.length) },
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
