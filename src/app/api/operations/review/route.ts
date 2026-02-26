import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR, resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
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
} from "@/lib/prompts";
import type { PipelinePhase, GroupChild } from "@/lib/process-manager";
import { reviewSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(reviewSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const readmeContent = getReadme(workspace) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);
  const wsPath = path.join(WORKSPACE_DIR, workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  // Write report templates (idempotent — ensures templates exist for older workspaces)
  writeReportTemplates(wsPath);

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
    const todoPath = path.join(wsPath, todoFileName);
    const todoContent = fs.existsSync(todoPath)
      ? fs.readFileSync(todoPath, "utf-8")
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

  try {
    const phases: PipelinePhase[] = [
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
          // List actual review/verify files that were created
          const files = fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir) : [];
          const actualReviewFiles = files.filter((f) => f.startsWith("REVIEW-"));
          const actualVerifyFiles = files.filter((f) => f.startsWith("VERIFY-"));

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

    const operation = startOperationPipeline("review", workspace, phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
