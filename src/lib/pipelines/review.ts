import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
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
  buildCollectorPrompt,
} from "@/lib/templates";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";

export async function buildReviewPipeline(input: {
  workspace: string;
}): Promise<PipelinePhase[]> {
  const { workspace } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);
  const wsPath = path.join(WORKSPACE_DIR, workspace);

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
    const verifyFileName = `VERIFY-${orgName}_${repo.repoName}.md`;

    // Code reviewer
    reviewChildren.push({
      label: `review-${repo.repoName}`,
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
    });

    // TODO verifier
    const todoFileName = `TODO-${repo.repoName}.md`;
    const todoFile = Bun.file(path.join(wsPath, todoFileName));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    reviewChildren.push({
      label: `verify-${repo.repoName}`,
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
      fn: async (ctx) => {
        // List actual review/verify files using Bun.Glob
        const reviewGlob = new Bun.Glob("REVIEW-*");
        const verifyGlob = new Bun.Glob("VERIFY-*");
        const actualReviewFiles = [...reviewGlob.scanSync({ cwd: reviewDir })];
        const actualVerifyFiles = [...verifyGlob.scanSync({ cwd: reviewDir })];

        const prompt = buildCollectorPrompt({
          workspaceName: workspace,
          reviewTimestamp,
          reviewDir,
          reviewFiles: actualReviewFiles.map((f) => path.join(reviewDir, f)),
          verifyFiles: actualVerifyFiles.map((f) => path.join(reviewDir, f)),
        });

        return ctx.runChild("Collect reviews", prompt);
      },
    },
  ];
}
