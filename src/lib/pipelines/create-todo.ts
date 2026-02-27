import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  commitWorkspaceSnapshot,
} from "@/lib/workspace";
import {
  buildCreateTodoFromReviewPrompt,
  buildCoordinatorPrompt,
  buildReviewerPrompt,
} from "@/lib/templates";
import { WORKSPACE_DIR } from "@/lib/config";
import type { PipelinePhase } from "@/lib/process-manager";

export function buildCreateTodoPipeline(
  workspace: string,
  reviewTimestamp: string,
): PipelinePhase[] {
  const wsPath = path.join(WORKSPACE_DIR, workspace);
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);

  return [
    // Phase A: Plan TODO from review (parallel per repo)
    {
      kind: "function",
      label: "Plan TODO from review",
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);
        const repos = listWorkspaceRepos(workspace);

        if (repos.length === 0) {
          ctx.emitResult("No repositories configured — skipping TODO creation.");
          return true;
        }

        const children = repos.map((repo) => ({
          label: `plan-${repo.repoName}`,
          prompt: buildCreateTodoFromReviewPrompt({
            workspaceName: workspace,
            repoPath: repo.repoPath,
            repoName: repo.repoName,
            readmeContent,
            worktreePath: repo.worktreePath,
            reviewDir,
            taskType: meta.taskType,
          }),
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
      fn: async (ctx) => {
        const { content: readmeContent } = await readWorkspaceReadme(wsPath);
        const repos = listWorkspaceRepos(workspace);

        if (repos.length <= 1) {
          ctx.emitResult("Skipped coordination (single repo).");
          return true;
        }

        const todoFiles: { repoName: string; content: string }[] = [];
        for (const repo of repos) {
          const todoFile = Bun.file(path.join(wsPath, `TODO-${repo.repoName}.md`));
          if (await todoFile.exists()) {
            todoFiles.push({
              repoName: repo.repoName,
              content: await todoFile.text(),
            });
          }
        }

        if (todoFiles.length === 0) {
          ctx.emitResult("No TODO files found, skipping coordination.");
          return true;
        }

        const prompt = buildCoordinatorPrompt({
          workspaceName: workspace,
          readmeContent,
          todoFiles,
          workspacePath: wsPath,
        });

        ctx.emitStatus("Coordinating TODOs across repositories");
        return ctx.runChild("Coordinate TODOs", prompt);
      },
    },
    // Phase C: Review TODOs (parallel per repo)
    {
      kind: "function",
      label: "Review TODOs",
      fn: async (ctx) => {
        const { content: readmeContent } = await readWorkspaceReadme(wsPath);
        const repos = listWorkspaceRepos(workspace);

        if (repos.length === 0) {
          ctx.emitResult("Skipped TODO review.");
          return true;
        }

        const children: { label: string; prompt: string }[] = [];
        for (const repo of repos) {
          const todoFile = Bun.file(path.join(wsPath, `TODO-${repo.repoName}.md`));
          if (!(await todoFile.exists())) continue;
          const todoContent = await todoFile.text();

          children.push({
            label: `review-${repo.repoName}`,
            prompt: buildReviewerPrompt({
              workspaceName: workspace,
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
    },
    // Phase D: Commit snapshot
    {
      kind: "function",
      label: "Commit snapshot",
      fn: async (ctx) => {
        ctx.emitStatus("Committing workspace snapshot...");
        await commitWorkspaceSnapshot(
          workspace,
          `Create TODO from review: ${reviewTimestamp}`,
        );
        ctx.emitResult(`TODO items created from review **${reviewTimestamp}**.`);
        return true;
      },
    },
  ];
}
