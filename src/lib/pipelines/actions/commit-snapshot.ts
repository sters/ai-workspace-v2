import { commitWorkspaceSnapshot } from "@/lib/workspace";
import type { PipelinePhaseFunction } from "@/types/pipeline";

export function buildCommitSnapshotPhase(
  workspaceName: string,
  commitMessage: string,
  resultMessage: string,
): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Commit snapshot",
    fn: async (ctx) => {
      ctx.emitStatus("Committing workspace snapshot...");
      await commitWorkspaceSnapshot(workspaceName, commitMessage);
      ctx.emitResult(resultMessage);
      return true;
    },
  };
}
