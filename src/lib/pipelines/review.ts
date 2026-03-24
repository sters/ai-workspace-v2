import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  prepareReviewDir,
  writeReportTemplates,
} from "@/lib/workspace";
import {
  buildCodeReviewerPrompt,
  buildTodoVerifierPrompt,
  buildReadmeVerifierPrompt,
  buildCollectorPrompt,
} from "@/lib/templates";
import { triggerWorkspaceSuggestion } from "@/lib/suggest-workspace";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";

export async function buildReviewPipeline(input: {
  workspace: string;
  repository?: string;
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
}): Promise<PipelinePhase[]> {
  const { workspace, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = input.repos ?? listWorkspaceRepos(workspace);
  const repos = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;
  const wsPath = path.join(getWorkspaceDir(), workspace);

  // Write report templates (idempotent — ensures templates exist for older workspaces)
  await writeReportTemplates(wsPath);

  const reviewTimestamp = prepareReviewDir(workspace);
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);

  // Build review + verify children for phase 1 (parallel)
  const reviewChildren: GroupChild[] = [];

  for (const repo of repos) {
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);
    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch);

    const orgName = repo.repoPath.split("/").slice(0, -1).join("_") || "local";
    const reviewFileName = `REVIEW-${orgName}_${repo.repoName}.md`;
    const verifyFileName = `VERIFY-TODO-${orgName}_${repo.repoName}.md`;

    // Code reviewer
    reviewChildren.push({
      label: `review-${repo.repoName}`,
      stepType: STEP_TYPES.CODE_REVIEW,
      prompt: buildCodeReviewerPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch,
        reviewTimestamp,
        readmeContent,
        worktreePath: repo.worktreePath,
        repoChanges: `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`,
        reviewFilePath: path.join(reviewDir, reviewFileName),
      }),
      addDirs: [reviewDir],
    });

    // TODO verifier
    const todoFileName = `TODO-${repo.repoName}.md`;
    const todoFile = Bun.file(path.join(wsPath, todoFileName));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    reviewChildren.push({
      label: `verify-todo-${repo.repoName}`,
      stepType: STEP_TYPES.VERIFY_TODO,
      prompt: buildTodoVerifierPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch,
        reviewTimestamp,
        todoContent,
        worktreePath: repo.worktreePath,
        verifyFilePath: path.join(reviewDir, verifyFileName),
      }),
      addDirs: [reviewDir],
    });

    // README verifier
    const readmeVerifyFileName = `VERIFY-README-${orgName}_${repo.repoName}.md`;
    reviewChildren.push({
      label: `verify-readme-${repo.repoName}`,
      stepType: STEP_TYPES.VERIFY_README,
      prompt: buildReadmeVerifierPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch,
        reviewTimestamp,
        readmeContent,
        worktreePath: repo.worktreePath,
        repoChanges: `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`,
        verifyFilePath: path.join(reviewDir, readmeVerifyFileName),
      }),
      addDirs: [reviewDir],
    });
  }

  return [
    // Phase 1: Run code reviews and TODO verifiers in parallel
    {
      kind: "group",
      children: reviewChildren,
    },
    // Phase 2: Collect results into summary
    {
      kind: "function",
      label: "Collect review results",
      timeoutMs: getTimeoutDefaults("review").claudeMs,
      fn: async (ctx) => {
        // List actual review/verify files using Bun.Glob
        const reviewGlob = new Bun.Glob("REVIEW-*");
        const verifyGlob = new Bun.Glob("VERIFY-TODO-*");
        const readmeVerifyGlob = new Bun.Glob("VERIFY-README-*");
        const actualReviewFiles = [...reviewGlob.scanSync({ cwd: reviewDir })];
        const actualReadmeVerifyFiles = new Set([...readmeVerifyGlob.scanSync({ cwd: reviewDir })]);
        const actualVerifyFiles = [...verifyGlob.scanSync({ cwd: reviewDir })];

        const prompt = buildCollectorPrompt({
          workspaceName: workspace,
          reviewTimestamp,
          reviewDir,
          reviewFiles: actualReviewFiles.map((f) => path.join(reviewDir, f)),
          verifyFiles: actualVerifyFiles.map((f) => path.join(reviewDir, f)),
          readmeVerifyFiles: [...actualReadmeVerifyFiles].map((f) => path.join(reviewDir, f)),
        });

        const ok = await ctx.runChild("Collect reviews", prompt, { addDirs: [reviewDir], stepType: STEP_TYPES.COLLECT_REVIEWS });
        if (ok) {
          triggerWorkspaceSuggestion(workspace, ctx.operationId, "review");
        }
        return ok;
      },
    },
  ];
}
