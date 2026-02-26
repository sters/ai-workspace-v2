import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { deleteWorkspace } from "@/lib/workspace";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
import { deleteSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(deleteSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);

  try {
    const operation = startOperationPipeline("delete", workspace, [
      {
        kind: "function",
        label: "Confirm deletion",
        fn: async (ctx) => {
          const answers = await ctx.emitAsk([
            {
              question: `Delete workspace "${workspace}"? This cannot be undone.`,
              options: [
                { label: "Delete", description: "Permanently delete this workspace and its worktrees" },
                { label: "Cancel", description: "Keep the workspace" },
              ],
            },
          ]);
          const answer = Object.values(answers)[0];
          if (answer !== "Delete") {
            ctx.emitResult("Deletion cancelled.");
            return false;
          }
          return true;
        },
      },
      {
        kind: "function",
        label: "Delete workspace",
        fn: async (ctx) => {
          ctx.emitStatus(`Deleting workspace: ${workspace}`);
          try {
            await deleteWorkspace(workspace);
            ctx.emitResult(`Deleted workspace: ${workspace}`);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.emitResult(`Failed to delete workspace: ${message}`);
            return false;
          }
        },
      },
    ]);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
