import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
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
  buildResearchFindingsRepoPrompt,
  buildResearchFindingsCrossRepoPrompt,
  buildResearchRecommendationsRepoPrompt,
  buildResearchRecommendationsCrossRepoPrompt,
  buildResearchIntegrationPrompt,
} from "@/lib/templates";
import { writeReportTemplates, writeResearchTemplates } from "@/lib/workspace";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { triggerWorkspaceSuggestion } from "@/lib/suggest-workspace";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";

const DEFAULT_BATCH_SIZE = 3;

export async function buildExecutePipeline(input: {
  workspace: string;
  batchSize?: number;
  repository?: string;
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
}): Promise<PipelinePhase[]> {
  const { workspace, batchSize = DEFAULT_BATCH_SIZE, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = input.repos ?? listWorkspaceRepos(workspace);
  const repos = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;
  const wsPath = path.join(getWorkspaceDir(), workspace);

  if (meta.taskType === "review") {
    return []; // Review workspaces skip execute entirely
  }

  const isResearch = meta.taskType === "research";

  if (isResearch) {
    // Write report templates (idempotent — ensures templates exist for older workspaces)
    await writeReportTemplates(wsPath);
    const reportDir = await writeResearchTemplates(wsPath);

    const repoInputs = repos.map((r) => ({
      repoPath: r.repoPath,
      repoName: r.repoName,
      worktreePath: r.worktreePath,
    }));

    return buildResearchPipeline({
      workspace,
      readmeContent,
      repos: repoInputs,
      wsPath,
      reportDir,
      sysPromptFiles: {
        findingsRepo: ensureSystemPrompt(wsPath, "research-findings-repo"),
        findingsCrossRepo: ensureSystemPrompt(wsPath, "research-findings-cross-repo"),
        recommendations: ensureSystemPrompt(wsPath, "research-recommendations"),
        integration: ensureSystemPrompt(wsPath, "research-integration"),
      },
    });
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
      fn: async (ctx: PhaseFunctionContext) => {
        const result = await executeRepoLanes(ctx, {
          workspace,
          readmeContent,
          repos,
          wsPath,
          batchSize,
        });
        if (result) {
          triggerWorkspaceSuggestion(workspace, ctx.operationId, "execute");
        }
        return result;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Research pipeline — 3-phase parallel execution
// ---------------------------------------------------------------------------

interface ResearchPipelineInput {
  workspace: string;
  readmeContent: string;
  repos: WorkspaceRepo[];
  wsPath: string;
  reportDir: string;
  sysPromptFiles: {
    findingsRepo: string;
    findingsCrossRepo: string;
    recommendations: string;
    integration: string;
  };
}

function buildResearchPipeline(input: ResearchPipelineInput): PipelinePhase[] {
  const { workspace, readmeContent, repos, wsPath, reportDir, sysPromptFiles } = input;

  // Phase 1 — Findings: N+1 parallel children (pre-computed prompts)
  const findingsPhase: PipelinePhase = {
    kind: "group",
    children: [
      ...repos.map((repo) => ({
        label: `Findings: ${repo.repoName}`,
        prompt: buildResearchFindingsRepoPrompt({
          workspaceName: workspace,
          readmeContent,
          repo,
          workspacePath: wsPath,
          reportDir,
        }),
        stepType: STEP_TYPES.RESEARCH,
        appendSystemPromptFile: sysPromptFiles.findingsRepo,
      })),
      {
        label: "Findings: Cross-Repository",
        prompt: buildResearchFindingsCrossRepoPrompt({
          workspaceName: workspace,
          readmeContent,
          repos,
          workspacePath: wsPath,
          reportDir,
        }),
        stepType: STEP_TYPES.RESEARCH,
        appendSystemPromptFile: sysPromptFiles.findingsCrossRepo,
      },
    ],
  };

  // Phase 2 — Recommendations & Next Steps: reads findings, runs N+1 parallel
  const recommendationsPhase: PipelinePhase = {
    kind: "function",
    label: "Recommendations & Next Steps",
    fn: async (ctx: PhaseFunctionContext) => {
      // Read findings produced by Phase 1
      const crossRepoFindings = await Bun.file(
        path.join(reportDir, "findings-cross-repository.md"),
      ).text().catch(() => "");

      const perRepoFindings = await Promise.all(
        repos.map(async (repo) => ({
          repoName: repo.repoName,
          content: await Bun.file(
            path.join(reportDir, `findings-${repo.repoName}.md`),
          ).text().catch(() => ""),
        })),
      );

      const allFindings = [
        ...perRepoFindings.map((f) => ({ name: `findings-${f.repoName}.md`, content: f.content })),
        { name: "findings-cross-repository.md", content: crossRepoFindings },
      ];

      const children = [
        ...repos.map((repo, i) => ({
          label: `Recommendations: ${repo.repoName}`,
          prompt: buildResearchRecommendationsRepoPrompt({
            workspaceName: workspace,
            readmeContent,
            repo,
            workspacePath: wsPath,
            reportDir,
            findingsContent: perRepoFindings[i].content,
            crossRepoFindingsContent: crossRepoFindings,
          }),
          stepType: STEP_TYPES.RESEARCH,
          appendSystemPromptFile: sysPromptFiles.recommendations,
        })),
        {
          label: "Recommendations: Cross-Repository",
          prompt: buildResearchRecommendationsCrossRepoPrompt({
            workspaceName: workspace,
            readmeContent,
            repos,
            workspacePath: wsPath,
            reportDir,
            allFindings,
          }),
          stepType: STEP_TYPES.RESEARCH,
          appendSystemPromptFile: sysPromptFiles.recommendations,
        },
      ];

      const results = await ctx.runChildGroup(children);
      return results.every(Boolean);
    },
  };

  // Phase 3 — Integration: reads everything, produces summary + others
  const integrationPhase: PipelinePhase = {
    kind: "function",
    label: "Integration",
    fn: async (ctx: PhaseFunctionContext) => {
      // Read all .md files from the report directory
      const glob = new Bun.Glob("*.md");
      const mdFiles = [...glob.scanSync({ cwd: reportDir })].sort();
      const allFiles = await Promise.all(
        mdFiles.map(async (f) => ({
          name: f,
          content: await Bun.file(path.join(reportDir, f)).text().catch(() => ""),
        })),
      );

      const prompt = buildResearchIntegrationPrompt({
        workspaceName: workspace,
        readmeContent,
        workspacePath: wsPath,
        reportDir,
        allFiles,
      });

      return ctx.runChild("Integration", prompt, {
        addDirs: [wsPath],
        stepType: STEP_TYPES.RESEARCH,
        appendSystemPromptFile: sysPromptFiles.integration,
      });
    },
  };

  return [findingsPhase, recommendationsPhase, integrationPhase];
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
      stepType: STEP_TYPES.EXECUTE,
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "executor"),
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
      { addDirs: [wsPath], stepType: STEP_TYPES.EXECUTE, appendSystemPromptFile: ensureSystemPrompt(wsPath, "executor") },
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
