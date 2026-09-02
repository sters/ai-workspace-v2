import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildPostReviewFindingsPipeline } from "@/lib/pipelines/post-review-findings";
import { postReviewFindingsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(postReviewFindingsSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const reviewTimestamp = parsed.data.reviewTimestamp;
  if (reviewTimestamp.includes("..") || reviewTimestamp.includes("/")) {
    return NextResponse.json({ error: "Invalid reviewTimestamp" }, { status: 400 });
  }
  // Duplicates would ground the same finding twice and post it twice within the
  // one review, where the marker check cannot see its own request.
  const findingIds = [...new Set(parsed.data.findingIds)];
  const submit = parsed.data.submit === true;

  try {
    const phases = buildPostReviewFindingsPipeline({
      workspace,
      reviewTimestamp,
      findingIds,
      submit,
    });
    const operation = startOperationPipeline(
      "post-review-findings",
      workspace,
      phases,
      undefined,
      {
        reviewTimestamp,
        findingCount: String(findingIds.length),
        submit: String(submit),
      },
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
