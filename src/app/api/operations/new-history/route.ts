import { NextResponse } from "next/server";
import { getOperationSummaries } from "@/lib/pipeline-manager";
import { listRecentNewOriginatedOperations } from "@/lib/operation-store";
import type { OperationListItem } from "@/types/operation";

export const dynamic = "force-dynamic";

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;

function parseLimit(raw: string | null): number {
  const parsed = raw == null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return LIMIT_DEFAULT;
  return Math.min(parsed, LIMIT_MAX);
}

function isNewOriginated(op: OperationListItem): boolean {
  if (op.type === "init") return true;
  if (op.type === "autonomous") {
    const inputs = op.inputs as { startWith?: unknown } | undefined;
    return inputs?.startWith === "init";
  }
  return false;
}

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));

    const inMemory = getOperationSummaries().filter(isNewOriginated);
    const inMemoryIds = new Set(inMemory.map((op) => op.id));

    const stored = listRecentNewOriginatedOperations(limit).filter(
      (op) => !inMemoryIds.has(op.id),
    );

    const merged: OperationListItem[] = [...inMemory, ...stored];

    merged.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });

    return NextResponse.json(merged.slice(0, limit));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
