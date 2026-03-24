import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { buildReviewerPrompt } from "@/lib/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhaseFunction } from "@/types/pipeline";

export function buildReviewTodosPhase(input: {
  workspace: string;
  wsPath: string;
  repos: Array<{ repoName: string; worktreePath: string }>;
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Review TODOs",
    fn: async (ctx) => {
      const { content: readmeContent } = await readWorkspaceReadme(input.wsPath);

      if (input.repos.length === 0) {
        ctx.emitResult("Skipped TODO review.");
        return true;
      }

      const children: GroupChild[] = [];
      for (const repo of input.repos) {
        const todoFile = Bun.file(
          `${input.wsPath}/TODO-${repo.repoName}.md`,
        );
        if (!(await todoFile.exists())) continue;
        const todoContent = await todoFile.text();

        children.push({
          label: `review-${repo.repoName}`,
          stepType: STEP_TYPES.REVIEW_TODOS,
          prompt: buildReviewerPrompt({
            workspaceName: input.workspace,
            repoName: repo.repoName,
            readmeContent,
            todoContent,
            worktreePath: repo.worktreePath,
          }),
        });
      }

      if (children.length === 0) {
        ctx.emitResult("No TODO files to review.");
        return true;
      }

      ctx.emitStatus(`Reviewing TODOs for ${children.length} repositories`);
      const results = await ctx.runChildGroup(children);
      const allSuccess = results.every(Boolean);
      ctx.emitStatus(
        `Review complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
      );

      return allSuccess;
    },
  };
}
