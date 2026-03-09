import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildSearchPipeline } from "@/lib/pipelines/search";
import { searchSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(searchSchema, body);
  if (!parsed.success) return parsed.response;

  try {
    const phases = buildSearchPipeline(parsed.data.query);
    const operation = startOperationPipeline("search", "deep-search", phases, undefined, {
      query: parsed.data.query,
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
