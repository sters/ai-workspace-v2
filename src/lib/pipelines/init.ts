import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import {
  parseAnalysisResultText,
  setupWorkspace,
  setupRepository,
  commitWorkspaceSnapshot,
  writeTodoTemplate,
  writeReportTemplates,
  README_TEMPLATE,
  type SetupRepositoryResult,
  type TaskAnalysis,
} from "@/lib/workspace";
import {
  buildInitAnalyzeAndReadmePrompt,
  INIT_ANALYSIS_SCHEMA,
  buildPlannerPrompt,
  buildCoordinatorPrompt,
  buildReviewerPrompt,
} from "@/lib/prompts";
import type { PipelinePhase } from "@/lib/process-manager";

export function buildInitPipeline(description: string): PipelinePhase[] {
  // Temp dir for draft README (analysis JSON is now returned via structured output)
  const tmpDir = path.join(os.tmpdir(), `ai-ws-init-${Date.now()}`);
  const tempReadmePath = path.join(tmpDir, "README.md");

  // Shared mutable state across pipeline phases
  let wsName = "";
  let wsPath = "";
  let analysis: TaskAnalysis | null = null;
  const repoResults: SetupRepositoryResult[] = [];

  return [
    // Phase A: Claude analyzes the task and drafts README (merged analysis + README fill)
    {
      kind: "function",
      label: "Analyze & draft README",
      fn: async (ctx) => {
        // Create temp dir and write README template for Claude to edit
        mkdirSync(tmpDir, { recursive: true });
        const today = new Date().toISOString().slice(0, 10);
        const readme = README_TEMPLATE
          .replace(/\{\{DESCRIPTION\}\}/g, description)
          .replace(/\{\{TASK_TYPE\}\}/g, "TBD")
          .replace(/\{\{TICKET_ID\}\}/g, "TBD")
          .replace(/\{\{DATE\}\}/g, today);
        await Bun.write(tempReadmePath, readme);

        const prompt = buildInitAnalyzeAndReadmePrompt({
          description,
          readmePath: tempReadmePath,
        });

        return ctx.runChild("Analyze & draft README", prompt, {
          jsonSchema: INIT_ANALYSIS_SCHEMA,
          onResultText: (text) => {
            analysis = parseAnalysisResultText(text, description);
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

        // Copy the Claude-edited README over the template README
        const tempReadme = Bun.file(tempReadmePath);
        if (await tempReadme.exists()) {
          const content = await tempReadme.text();
          await Bun.write(path.join(wsPath, "README.md"), content);
        }

        // Clean up temp dir
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

        // Write template files for agents to reference
        await writeTodoTemplate(wsPath, analysis.taskType);
        await writeReportTemplates(wsPath);

        if (analysis.repositories.length > 0) {
          for (const repoPath of analysis.repositories) {
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

        // Re-commit with the edited README
        await commitWorkspaceSnapshot(wsName, "Init: workspace created with README");

        const repoSummary = repoResults.length > 0
          ? `\nRepositories: ${repoResults.map((r) => `${r.repoName} (${r.branchName})`).join(", ")}`
          : "";
        ctx.emitResult(`Workspace **${wsName}** created.${repoSummary}`);
        return true;
      },
    },
    // Phase C: Detect task type and setup any additional repos from README
    {
      kind: "function",
      label: "Prepare for planning",
      fn: async (ctx) => {
        const { meta } = await readWorkspaceReadme(wsPath);

        // If repos were added to README but not set up yet, set them up now
        for (const metaRepo of meta.repositories) {
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

        const isResearch = meta.taskType === "research" || meta.taskType === "investigation";
        if (isResearch) {
          await commitWorkspaceSnapshot(wsName, "Setup complete (research task)");
          ctx.emitResult("Research/investigation task — skipping TODO planning.");
          return true;
        }

        if (repoResults.length === 0) {
          await commitWorkspaceSnapshot(wsName, "Setup complete (no repos)");
          ctx.emitResult("No repositories configured — skipping TODO planning.");
          return true;
        }

        ctx.emitResult(`Ready to plan: ${repoResults.length} repo(s), task type: ${meta.taskType}`);
        return true;
      },
    },
    // Phase D: Plan TODOs for each repo (parallel)
    {
      kind: "function",
      label: "Plan TODO items",
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);

        const isResearch = meta.taskType === "research" || meta.taskType === "investigation";
        if (isResearch || repoResults.length === 0) {
          ctx.emitResult("Skipped TODO planning.");
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
    // Phase E: Coordinate TODOs across repos (single, skip for single repo)
    {
      kind: "function",
      label: "Coordinate TODOs",
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);
        const isResearch = meta.taskType === "research" || meta.taskType === "investigation";
        if (isResearch || repoResults.length <= 1) {
          ctx.emitResult("Skipped coordination (single repo or research task).");
          return true;
        }

        const todoFiles: { repoName: string; content: string }[] = [];
        for (const repo of repoResults) {
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
          workspaceName: wsName,
          readmeContent,
          todoFiles,
          workspacePath: wsPath,
        });

        ctx.emitStatus("Coordinating TODOs across repositories");
        return ctx.runChild("Coordinate TODOs", prompt);
      },
    },
    // Phase F: Review TODOs (parallel, per repo)
    {
      kind: "function",
      label: "Review TODOs",
      fn: async (ctx) => {
        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);
        const isResearch = meta.taskType === "research" || meta.taskType === "investigation";
        if (isResearch || repoResults.length === 0) {
          ctx.emitResult("Skipped TODO review.");
          return true;
        }

        const children: { label: string; prompt: string }[] = [];
        for (const repo of repoResults) {
          const todoFile = Bun.file(path.join(wsPath, `TODO-${repo.repoName}.md`));
          if (!(await todoFile.exists())) continue;
          const todoContent = await todoFile.text();

          children.push({
            label: `review-${repo.repoName}`,
            prompt: buildReviewerPrompt({
              workspaceName: wsName,
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
    // Phase G: Commit workspace snapshot
    {
      kind: "function",
      label: "Commit snapshot",
      fn: async (ctx) => {
        ctx.emitStatus("Committing workspace snapshot...");
        await commitWorkspaceSnapshot(wsName, "Init complete: workspace setup and TODO planning");
        ctx.emitResult(`Workspace **${wsName}** initialization complete.`);
        return true;
      },
    },
  ];
}
