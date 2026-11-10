import { NextResponse } from "next/server";
import { listPrEvents } from "@/lib/db/pr-watch";

export const dynamic = "force-dynamic";

/** What the PR watcher recorded for this workspace, oldest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return NextResponse.json({ events: listPrEvents(decodeURIComponent(name)) });
}
