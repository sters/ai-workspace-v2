import { pathExists } from "@/lib/fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readWorkspaceReadme, denormalizeRepoPath } from "@/lib/parsers/readme";
import {
  parseAnalysisResultText,
  setupWorkspace,
  commitWorkspaceSnapshot,
  writeTodoTemplate,
  writeReportTemplates,
} from "@/lib/workspace";
import { ensureGlobalSystemPrompt } from "@/lib/workspace/prompts";
import type { TaskAnalysis } from "@/types/workspace";
import { setupRepositories, setupRepository } from "./actions/setup-repository";
import type { SetupRepositoryResult } from "@/types/pipeline";
import { extractPrUrls, resolvePrBranch } from "@/lib/workspace/pr-url";
import type { PrBranchInfo } from "@/lib/workspace/pr-url";
import {
  buildReadmeContent,
  buildInitAnalyzeAndReadmePrompt,
  INIT_ANALYSIS_SCHEMA,
} from "@/lib/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";
import { buildInitTodoAnalysisPhases } from "./actions/init-todo-analysis";

/**
 * Budget for `Setup workspace`, which clones or fetches every repository and
 * checks out one worktree per entry. A first clone of a large repository, or
 * a request for a worktree per environment of many services, takes minutes.
 */
const SETUP_WORKSPACE_TIMEOUT_MS = 15 * 60 * 1000;

/** Parse analysis from Claude's onResultText callback. */
function parseAnalysis(
  text: string | undefined,
  description: string,
): TaskAnalysis & { readmeContent?: string } {
  const base = parseAnalysisResultText(text, description);
  let readmeContent: string | undefined;
  if (text) {
    try {
      const { values } = Bun.JSONL.parseChunk(text);
      if (values.length > 0) {
        const parsed = values[0] as Record<string, unknown>;
        if (typeof parsed.readmeContent === "string") {
          readmeContent = parsed.readmeContent;
        }
      }
    } catch { /* use template as fallback */ }
  }
  return { ...base, readmeContent };
}

export function buildInitPipeline(
  description: string,
  interactionLevel?: InteractionLevel,
): PipelinePhase[] {
  // Shared mutable state across pipeline phases
  let wsName = "";
  let wsPath = "";
  let analysis: (TaskAnalysis & { readmeContent?: string }) | null = null;
  const repoResults: SetupRepositoryResult[] = [];

  return [
    // Phase A: Claude analyzes the task and drafts README (merged analysis + README fill)
    {
      kind: "function",
      label: "Analyze & draft README",
      timeoutMs: 60 * 60 * 1000, // 1 hour — may wait for human confirmation
      fn: async (ctx) => {
        // Build README template content to include in the prompt
        const today = new Date().toISOString().slice(0, 10);
        const readmeTemplate = buildReadmeContent(description, "TBD", "TBD", today);

        const prompt = buildInitAnalyzeAndReadmePrompt({
          description,
          readmeTemplate,
          interactionLevel,
        });

        const initReadmePromptFile = await ensureGlobalSystemPrompt("init-readme");
        return ctx.runChild("Analyze & draft README", prompt, {
          jsonSchema: INIT_ANALYSIS_SCHEMA,
          stepType: STEP_TYPES.ANALYZE_README,
          appendSystemPromptFile: initReadmePromptFile,
          onResultText: (text) => {
            analysis = parseAnalysis(text, description);
          },
        });
      },
    },
    // Phase B: Read analysis result, create workspace, copy README, setup repos
    // No retries: retrying would create duplicate workspaces since Phase B is not idempotent
    {
      kind: "function",
      label: "Setup workspace",
      maxRetries: 0,
      timeoutMs: SETUP_WORKSPACE_TIMEOUT_MS,
      fn: async (ctx) => {
        // Use structured output analysis; fall back to defaults if unavailable
        if (!analysis) {
          analysis = parseAnalysisResultText(undefined, description);
        }

        ctx.emitStatus(
          `Detected: type=${analysis.taskType}, slug=${analysis.slug}` +
            (analysis.ticketId ? `, ticket=${analysis.ticketId}` : "") +
            (analysis.repositories.length > 0
              ? `, repos=[${analysis.repositories.join(", ")}]`
              : ""),
        );

        ctx.emitStatus("Creating workspace directory...");
        const result = await setupWorkspace(
          analysis.taskType,
          description,
          analysis.ticketId || undefined,
          analysis.slug,
        );
        wsName = result.workspaceName;
        wsPath = result.workspacePath;
        ctx.setWorkspace(wsName);
        ctx.emitStatus(`Workspace created: ${wsName}`);

        // Overwrite template README with Claude-edited content from structured output
        if (analysis?.readmeContent) {
          await Bun.write(path.join(wsPath, "README.md"), analysis.readmeContent);
        }

        // Write template files for agents to reference
        if (analysis.taskType !== "review" && analysis.taskType !== "research") {
          await writeTodoTemplate(wsPath, analysis.taskType);
        }
        await writeReportTemplates(wsPath);

        // Detect PR URLs from description and README content for branch resolution
        const prUrlMap = new Map<string, PrBranchInfo>();
        const allText = [description, analysis.readmeContent ?? ""].join("\n");
        const prUrls = extractPrUrls(allText);
        for (const prUrl of prUrls) {
          try {
            ctx.emitStatus(`Resolving PR branch info: ${prUrl.url}`);
            const prInfo = await resolvePrBranch(prUrl);
            prUrlMap.set(prUrl.repoPath, prInfo);
            ctx.emitStatus(`PR #${prUrl.prNumber}: ${prInfo.headBranch} → ${prInfo.baseBranch}${prInfo.isFork ? " (fork)" : ""}`);
          } catch (err) {
            ctx.emitStatus(`Warning: Failed to resolve PR ${prUrl.url}: ${err}`);
          }
        }

        if (analysis.repositories.length > 0) {
          const outcomes = await setupRepositories(
            wsName,
            analysis.repositories.map((repoPath) => ({
              repoPath,
              // PR URLs are keyed by bare repo path, but repoPath may carry a `:alias` suffix.
              // Only use PR info for baseBranch — init always creates a new branch.
              // Checking out the PR's headBranch would conflict with existing worktrees.
              baseBranchOverride: prUrlMap.get(repoPath.split(":")[0])?.baseBranch,
            })),
            ctx.emitStatus,
            { signal: ctx.signal },
          );
          if (ctx.signal.aborted) return false;
          const failures = outcomes.flatMap((o) =>
            o.ok ? [] : [`Failed to setup repository ${o.repoPath}: ${o.error}`],
          );
          if (failures.length > 0) {
            ctx.emitResult(failures.join("\n"));
            return false;
          }
          for (const o of outcomes) if (o.ok) repoResults.push(o.result);
        }

        if (ctx.signal.aborted) return false;

        // Setup any additional repos that Claude added to the README but weren't in the analysis
        const { meta } = await readWorkspaceReadme(wsPath);
        for (const metaRepo of meta.repositories) {
          if (ctx.signal.aborted) return false;
          const already = repoResults.find(
            (r) => r.repoPath === metaRepo.path || r.repoName === metaRepo.alias,
          );
          if (!already) {
            ctx.emitStatus(`Setting up newly identified repository: ${metaRepo.path}`);
            try {
              // Parser stores `___alias`; setupRepository expects the `:alias` form.
              const repoResult = await setupRepository(
                wsName,
                denormalizeRepoPath(metaRepo.path),
                metaRepo.baseBranch,
                ctx.emitStatus,
              );
              repoResults.push(repoResult);
            } catch (err) {
              ctx.emitStatus(`Warning: Failed to setup ${metaRepo.path}: ${err}`);
            }
          }
        }

        // Update README base branch info from resolved PR data
        if (prUrlMap.size > 0) {
          const readmePath = path.join(wsPath, "README.md");
          if (await pathExists(readmePath)) {
            let readmeText = await readFile(readmePath, "utf-8");
            for (const [_repoPath, prInfo] of prUrlMap) {
              // Update (base: `main`) → (base: `actual-branch`) for matching repos
              const repoName = _repoPath.split("/").pop() ?? "";
              if (repoName) {
                const bt = "`";
                const basePattern = new RegExp(
                  "(\\*\\*" + repoName + "\\*\\*:.*?\\(base:\\s*" + bt + ")([^" + bt + "]+)(" + bt + "\\))",
                );
                readmeText = readmeText.replace(basePattern, "$1" + prInfo.baseBranch + "$3");
              }
            }
            await writeFile(readmePath, readmeText, "utf-8");
          }
        }

        // Re-commit with the edited README
        await commitWorkspaceSnapshot(wsName, "Init: workspace created with README");

        const repoSummary = repoResults.length > 0
          ? `\nRepositories: ${repoResults.map((r) => `${r.repoName} (${r.branchName})`).join(", ")}`
          : "";
        ctx.emitResult(`Workspace **${wsName}** created.${repoSummary}`);
        return true;
      },
    },
    // Phases C–G: constraints, plan, coordinate, review, commit
    ...buildInitTodoAnalysisPhases({
      wsName: () => wsName,
      wsPath: () => wsPath,
      repos: () => repoResults.map((r) => ({
        repoPath: r.repoPath,
        repoName: r.repoName,
        worktreePath: r.worktreePath,
      })),
      taskType: () => analysis?.taskType ?? "",
      interactionLevel,
    }),
  ];
}
