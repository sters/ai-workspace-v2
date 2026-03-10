import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import {
  parseTodoItems,
  groupTodoItemsWithParents,
  batchTodoGroups,
  renderTodoGroupsAsMarkdown,
} from "@/lib/parsers/todo";
import { listWorkspaceRepos, commitWorkspaceSnapshot } from "@/lib/workspace";
import {
  buildExecutorPrompt,
  buildBatchedExecutorPrompt,
  buildResearcherPrompt,
} from "@/lib/templates";
import { writeReportTemplates } from "@/lib/workspace";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";

const DEFAULT_BATCH_SIZE = 3;

export async function buildExecutePipeline(input: {
  workspace: string;
  batchSize?: number;
}): Promise<PipelinePhase[]> {
  const { workspace, batchSize = DEFAULT_BATCH_SIZE } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);
  const wsPath = path.join(WORKSPACE_DIR, workspace);

  const isResearch = meta.taskType === "research";

  if (isResearch) {
    // Write report templates (idempotent — ensures templates exist for older workspaces)
    await writeReportTemplates(wsPath);

    const reportPath = path.join(wsPath, "artifacts", "research-report.md");
    const prompt = buildResearcherPrompt({
      workspaceName: workspace,
      readmeContent,
      repos: repos.map((r) => ({
        repoPath: r.repoPath,
        repoName: r.repoName,
        worktreePath: r.worktreePath,
      })),
      workspacePath: wsPath,
      reportPath,
    });

    return [
      { kind: "single", label: "Research", prompt },
    ];
  }

  // Estimate max batches for timeout calculation
  const maxBatchesPerRepo = await estimateMaxBatches(repos, wsPath, batchSize);
  const timeoutMs = maxBatchesPerRepo * 20 * 60 * 1000 + 5 * 60 * 1000; // maxBatches * 20min + 5min buffer

  // Feature/bugfix: launch independent lanes per repository with batch splitting
  return [
    {
      kind: "function",
      label: "Execute",
      timeoutMs,
      fn: (ctx: PhaseFunctionContext) =>
        executeRepoLanes(ctx, {
          workspace,
          readmeContent,
          repos,
          wsPath,
          batchSize,
        }),
    },
  ];
}

async function estimateMaxBatches(
  repos: WorkspaceRepo[],
  wsPath: string,
  batchSize: number,
): Promise<number> {
  let max = 1;
  for (const repo of repos) {
    const todoFile = Bun.file(path.join(wsPath, `TODO-${repo.repoName}.md`));
    if (!(await todoFile.exists())) continue;
    const content = await todoFile.text();
    const items = parseTodoItems(content);
    const groups = groupTodoItemsWithParents(items);
    const batches = batchTodoGroups(groups, batchSize);
    if (batches.length > max) max = batches.length;
  }
  return max;
}

interface LaneInput {
  workspace: string;
  readmeContent: string;
  repos: WorkspaceRepo[];
  wsPath: string;
  batchSize: number;
}

async function executeRepoLanes(
  ctx: PhaseFunctionContext,
  input: LaneInput,
): Promise<boolean> {
  const { workspace, readmeContent, repos, wsPath, batchSize } = input;

  const results = await Promise.all(
    repos.map((repo) =>
      executeRepoLane(ctx, {
        workspace,
        readmeContent,
        repo,
        wsPath,
        batchSize,
      }),
    ),
  );

  return results.every(Boolean);
}

interface SingleLaneInput {
  workspace: string;
  readmeContent: string;
  repo: WorkspaceRepo;
  wsPath: string;
  batchSize: number;
}

async function executeRepoLane(
  ctx: PhaseFunctionContext,
  input: SingleLaneInput,
): Promise<boolean> {
  const { workspace, readmeContent, repo, wsPath, batchSize } = input;

  // Read TODO file
  const todoFileName = `TODO-${repo.repoName}.md`;
  const todoFilePath = path.join(wsPath, todoFileName);
  const todoFile = Bun.file(todoFilePath);
  const todoContent = (await todoFile.exists()) ? await todoFile.text() : "";

  // Parse and group TODO items
  const items = parseTodoItems(todoContent);
  const groups = groupTodoItemsWithParents(items);
  const batches = batchTodoGroups(groups, batchSize);

  // If 3 or fewer actionable top-level items → no batching, single call
  if (batches.length <= 1) {
    ctx.emitStatus(`[${repo.repoName}] Executing (no batching needed)`);
    const prompt = buildExecutorPrompt({
      workspaceName: workspace,
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      readmeContent,
      todoContent,
      worktreePath: repo.worktreePath,
      workspacePath: wsPath,
    });
    return ctx.runChild(repo.repoName, prompt, {
      addDirs: [wsPath],
    });
  }

  // Batched execution loop
  const totalBatches = batches.length;
  const completedItems: string[] = [];

  for (let i = 0; i < totalBatches; i++) {
    // Re-read TODO file before each batch (it may have been updated)
    const currentTodoFile = Bun.file(todoFilePath);
    const currentTodoContent = (await currentTodoFile.exists())
      ? await currentTodoFile.text()
      : "";

    // Re-parse to get fresh state
    const currentItems = parseTodoItems(currentTodoContent);
    const currentGroups = groupTodoItemsWithParents(currentItems);
    const remainingBatches = batchTodoGroups(currentGroups, batchSize);

    // Early exit if all items are completed
    if (remainingBatches.length === 0) {
      ctx.emitStatus(
        `[${repo.repoName}] All items completed after batch ${i}/${totalBatches}`,
      );
      break;
    }

    // Take the first batch of remaining actionable items
    const currentBatch = remainingBatches[0];
    const batchContent = renderTodoGroupsAsMarkdown(currentBatch);
    const completedSummary =
      completedItems.length > 0
        ? completedItems.map((t) => `- [x] ${t}`).join("\n")
        : undefined;

    ctx.emitStatus(
      `[${repo.repoName}] Executing batch ${i + 1}/${totalBatches}`,
    );

    const prompt = buildBatchedExecutorPrompt({
      workspaceName: workspace,
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      readmeContent,
      todoContent: currentTodoContent,
      worktreePath: repo.worktreePath,
      workspacePath: wsPath,
      batchIndex: i,
      totalBatches,
      batchTodoContent: batchContent,
      completedSummary,
    });

    const success = await ctx.runChild(
      `${repo.repoName} [batch ${i + 1}/${totalBatches}]`,
      prompt,
      { addDirs: [wsPath] },
    );

    if (!success) {
      ctx.emitStatus(
        `[${repo.repoName}] Batch ${i + 1}/${totalBatches} failed`,
      );
      return false;
    }

    // Track completed items from this batch for summary
    for (const group of currentBatch) {
      completedItems.push(group.parent.text);
    }

    // Commit workspace snapshot after each batch
    await commitWorkspaceSnapshot(
      workspace,
      `Batch ${i + 1}/${totalBatches} completed for ${repo.repoName}`,
    );
  }

  return true;
}
