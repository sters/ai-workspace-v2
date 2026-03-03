import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import {
  parseAnalysisResultText,
  setupWorkspace,
  commitWorkspaceSnapshot,
  writeTodoTemplate,
  writeReportTemplates,
} from "@/lib/workspace";
import type { TaskAnalysis } from "@/types/workspace";
import { setupRepository } from "./actions/setup-repository";
import type { SetupRepositoryResult } from "@/types/pipeline";
import {
  buildReadmeContent,
  buildInitAnalyzeAndReadmePrompt,
  INIT_ANALYSIS_SCHEMA,
  buildPlannerPrompt,
} from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";
import { DEFAULT_CLAUDE_TIMEOUT_MS } from "@/lib/pipeline-manager";
import { buildCommitSnapshotPhase } from "./actions/commit-snapshot";
import { buildCoordinateTodosPhase } from "./actions/coordinate-todos";
import { buildReviewTodosPhase } from "./actions/review-todos";

export function buildInitPipeline(description: string): PipelinePhase[] {
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
      timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
      fn: async (ctx) => {
        // Build README template content to include in the prompt
        const today = new Date().toISOString().slice(0, 10);
        const readmeTemplate = buildReadmeContent(description, "TBD", "TBD", today);

        const prompt = buildInitAnalyzeAndReadmePrompt({
          description,
          readmeTemplate,
        });

        return ctx.runChild("Analyze & draft README", prompt, {
          jsonSchema: INIT_ANALYSIS_SCHEMA,
          onResultText: (text) => {
            analysis = parseAnalysisResultText(text, description);
            // Extract readmeContent from the structured output
            if (text) {
              try {
                const { values } = Bun.JSONL.parseChunk(text);
                if (values.length > 0) {
                  const parsed = values[0] as Record<string, unknown>;
                  if (typeof parsed.readmeContent === "string") {
                    analysis = { ...analysis!, readmeContent: parsed.readmeContent };
                  }
                }
              } catch { /* use template as fallback */ }
            }
          },
        });
      },
    },
    // Phase B: Read analysis result, create workspace, copy README, setup repos
    {
      kind: "function",
      label: "Setup workspace",
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
        await writeTodoTemplate(wsPath, analysis.taskType);
        await writeReportTemplates(wsPath);

        if (analysis.repositories.length > 0) {
          for (const repoPath of analysis.repositories) {
            if (ctx.signal.aborted) return false;
            ctx.emitStatus(`Setting up repository: ${repoPath}`);
            try {
              const repoResult = setupRepository(wsName, repoPath, undefined, ctx.emitStatus);
              repoResults.push(repoResult);
            } catch (err) {
              ctx.emitResult(`Failed to setup repository ${repoPath}: ${err}`);
              return false;
            }
          }
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
              const repoResult = setupRepository(wsName, metaRepo.path, metaRepo.baseBranch, ctx.emitStatus);
              repoResults.push(repoResult);
            } catch (err) {
              ctx.emitStatus(`Warning: Failed to setup ${metaRepo.path}: ${err}`);
            }
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
    // Phase C: Plan TODOs for each repo (parallel)
    {
      kind: "function",
      label: "Plan TODO items",
      timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);

        if (repoResults.length === 0) {
          ctx.emitResult("No repositories configured — skipping TODO planning.");
          return true;
        }

        const children = repoResults.map((repo) => ({
          label: `plan-${repo.repoName}`,
          prompt: buildPlannerPrompt({
            workspaceName: wsName,
            repoPath: repo.repoPath,
            repoName: repo.repoName,
            readmeContent,
            worktreePath: repo.worktreePath,
            taskType: meta.taskType,
          }),
        }));

        ctx.emitStatus(`Planning TODOs for ${children.length} repositories`);
        const results = await ctx.runChildGroup(children);
        const allSuccess = results.every(Boolean);
        ctx.emitStatus(
          `Planning complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
        );

        return allSuccess;
      },
    },
    // Phase D: Coordinate TODOs across repos (single, skip for single repo)
    // Delegates to shared action at runtime when wsName/repoResults are populated
    {
      kind: "function",
      label: "Coordinate TODOs",
      timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
      fn: (ctx) => buildCoordinateTodosPhase({
        workspace: wsName,
        wsPath,
        repoNames: repoResults.map((r) => r.repoName),
      }).fn(ctx),
    },
    // Phase E: Review TODOs (parallel, per repo)
    {
      kind: "function",
      label: "Review TODOs",
      timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
      fn: (ctx) => buildReviewTodosPhase({
        workspace: wsName,
        wsPath,
        repos: repoResults.map((r) => ({
          repoName: r.repoName,
          worktreePath: r.worktreePath,
        })),
      }).fn(ctx),
    },
    // Phase F: Commit workspace snapshot
    {
      kind: "function",
      label: "Commit snapshot",
      fn: (ctx) => buildCommitSnapshotPhase(
        wsName,
        "Init complete: workspace setup and TODO planning",
        `Workspace **${wsName}** initialization complete.`,
      ).fn(ctx),
    },
  ];
}
