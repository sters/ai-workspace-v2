import { reconcileInterrupted } from "@/lib/verification/runner";
import { listScenarios } from "@/lib/verification/store";
import { workspacePathFor } from "@/lib/verification/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const wsPath = workspacePathFor((await params).name);
  if (!wsPath) return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  return Response.json({ scenarios: await reconcileInterrupted(wsPath, await listScenarios(wsPath)) });
}
