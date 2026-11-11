import { NextResponse } from "next/server";
import { markPrHandled } from "@/lib/db/pr-watch";
import { getWorkspacePrSuggestions } from "@/lib/pr-watcher";

export const dynamic = "force-dynamic";

/** What the PR tab proposes doing about this workspace's PRs. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return NextResponse.json(await getWorkspacePrSuggestions(decodeURIComponent(name)));
}

/** Mark the current triage proposal taken or dismissed; only what happens later is proposed again. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  markPrHandled(decodeURIComponent(name));
  return NextResponse.json({ ok: true });
}
