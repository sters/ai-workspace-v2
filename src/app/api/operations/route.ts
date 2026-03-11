import { NextResponse } from "next/server";
import { getOperationSummaries } from "@/lib/pipeline-manager";
import { listStoredOperations } from "@/lib/operation-store";
import type { OperationListItem } from "@/types/operation";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const workspace = url.searchParams.get("workspace");
  const status = url.searchParams.get("status");

  // Fast path: only return in-memory running operations (no disk I/O)
  if (status === "running") {
    let running = getOperationSummaries().filter((op) => op.status === "running");
    if (workspace) {
      running = running.filter((op) => op.workspace === workspace);
    }
    running.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return NextResponse.json(running);
  }

  // Full listing: merge in-memory summaries with disk-stored summaries
  const inMemory = getOperationSummaries();
  const inMemoryIds = new Set(inMemory.map((op) => op.id));

  // When workspace is specified, only scan that directory on disk
  const stored = listStoredOperations(workspace ?? undefined).filter((op) => !inMemoryIds.has(op.id));
  let merged: OperationListItem[] = [...inMemory, ...stored];

  // Filter in-memory operations by workspace (disk ones are already filtered)
  if (workspace) {
    merged = merged.filter((op) => op.workspace === workspace);
  }

  // Sort: running first, then by startedAt descending
  merged.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return NextResponse.json(merged);
}
