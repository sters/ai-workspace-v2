import path from "node:path";
import { buildRepoConstraintsPrompt } from "@/lib/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhaseFunction } from "@/types/pipeline";

export function buildDiscoverConstraintsPhase(input: {
  workspace: string;
  wsPath: string;
  repos: { repoName: string; worktreePath: string }[];
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Discover repo constraints",
    fn: async (ctx) => {
      if (input.repos.length === 0) {
        ctx.emitResult("No repositories configured — skipping constraint discovery.");
        return true;
      }

      const readmePath = path.join(input.wsPath, "README.md");

      const children = input.repos.map((repo) => ({
        label: `constraints-${repo.repoName}`,
        stepType: STEP_TYPES.DISCOVER_CONSTRAINTS,
        prompt: buildRepoConstraintsPrompt({
          workspaceName: input.workspace,
          repoName: repo.repoName,
          worktreePath: repo.worktreePath,
          readmePath,
        }),
        addDirs: [input.wsPath],
      }));

      ctx.emitStatus(`Discovering constraints for ${children.length} repositories`);
      const results = await ctx.runChildGroup(children);
      const succeeded = results.filter(Boolean).length;
      ctx.emitStatus(`Constraint discovery complete: ${succeeded}/${results.length} succeeded`);
      return results.every(Boolean);
    },
  };
}
