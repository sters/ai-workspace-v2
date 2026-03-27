import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildCreateTodoFromReviewPrompt } from "@/lib/templates";
import { getWorkspaceDir } from "@/lib/config";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";
import { buildCommitSnapshotPhase } from "./actions/commit-snapshot";
import { buildCoordinateTodosPhase } from "./actions/coordinate-todos";
import { buildReviewTodosPhase } from "./actions/review-todos";

export function buildCreateTodoPipeline(
  workspace: string,
  reviewTimestamp: string,
  instruction?: string,
): PipelinePhase[] {
  const wsPath = path.join(getWorkspaceDir(), workspace);
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);

  return [
    // Phase A: Plan TODO from review (parallel per repo)
    {
      kind: "function",
      label: "Plan TODO from review",
      timeoutMs: getTimeoutDefaults("create-todo").claudeMs,
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);
        const repos = listWorkspaceRepos(workspace);

        if (repos.length === 0) {
          ctx.emitResult("No repositories configured — skipping TODO creation.");
          return true;
        }

        const children = repos.map((repo) => ({
          label: `plan-${repo.repoName}`,
          stepType: STEP_TYPES.PLAN_TODO_FROM_REVIEW,
          prompt: buildCreateTodoFromReviewPrompt({
            workspaceName: workspace,
            repoPath: repo.repoPath,
            repoName: repo.repoName,
            readmeContent,
            worktreePath: repo.worktreePath,
            reviewDir,
            taskType: meta.taskType,
            instruction,
          }),
          addDirs: [wsPath],
          appendSystemPromptFile: ensureSystemPrompt(wsPath, "create-todo-planner"),
        }));

        ctx.emitStatus(`Creating TODOs from review for ${children.length} repositories`);
        const results = await ctx.runChildGroup(children);
        const allSuccess = results.every(Boolean);
        ctx.emitStatus(
          `TODO planning complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
        );

        return allSuccess;
      },
    },
    // Phase B: Coordinate TODOs across repos (skip if single repo)
    {
      kind: "function",
      label: "Coordinate TODOs",
      timeoutMs: getTimeoutDefaults("create-todo").claudeMs,
      fn: (ctx) => {
        const repos = listWorkspaceRepos(workspace);
        return buildCoordinateTodosPhase({
          workspace,
          wsPath,
          repoNames: repos.map((r) => r.repoName),
        }).fn(ctx);
      },
    },
    // Phase C: Review TODOs (parallel per repo)
    {
      kind: "function",
      label: "Review TODOs",
      timeoutMs: getTimeoutDefaults("create-todo").claudeMs,
      fn: (ctx) => {
        const repos = listWorkspaceRepos(workspace);
        return buildReviewTodosPhase({
          workspace,
          wsPath,
          repos: repos.map((r) => ({
            repoName: r.repoName,
            worktreePath: r.worktreePath,
          })),
        }).fn(ctx);
      },
    },
    // Phase D: Commit snapshot
    buildCommitSnapshotPhase(
      workspace,
      `Create TODO from review: ${reviewTimestamp}`,
      `TODO items created from review **${reviewTimestamp}**.`,
    ),
  ];
}
