import { NextResponse } from "next/server";
import { reconcileInterrupted } from "@/lib/verification/runner";
import { listScenarios } from "@/lib/verification/store";
import { workspacePathFor } from "@/lib/verification/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const wsPath = workspacePathFor((await params).name);
  if (!wsPath) return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  return NextResponse.json({ scenarios: await reconcileInterrupted(wsPath, await listScenarios(wsPath)) });
}
