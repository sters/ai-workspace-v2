import { NextResponse } from "next/server";
import { getOperations } from "@/lib/pipeline-manager";
import { listStoredOperations } from "@/lib/operation-store";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const workspace = url.searchParams.get("workspace");

  // Merge in-memory operations with disk-stored operations
  const inMemory = getOperations();
  const inMemoryIds = new Set(inMemory.map((op) => op.id));

  // When workspace is specified, only scan that directory on disk
  const stored = listStoredOperations(workspace ?? undefined).filter((op) => !inMemoryIds.has(op.id));
  let merged = [...inMemory, ...stored];

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
