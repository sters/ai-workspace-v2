import { deleteWorkspace } from "@/lib/workspace";
import type { PipelinePhase } from "@/types/pipeline";

export function buildDeletePipeline(workspace: string): PipelinePhase[] {
  return [
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
  ];
}
