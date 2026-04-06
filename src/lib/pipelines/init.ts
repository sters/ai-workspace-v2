import { unlinkSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import {
  parseAnalysisResultText,
  setupWorkspace,
  commitWorkspaceSnapshot,
  writeTodoTemplate,
  writeReportTemplates,
} from "@/lib/workspace";
import { ensureGlobalSystemPrompt, ensureSystemPrompt } from "@/lib/workspace/prompts";
import type { TaskAnalysis } from "@/types/workspace";
import { setupRepository } from "./actions/setup-repository";
import type { SetupRepositoryResult } from "@/types/pipeline";
import { extractPrUrls, resolvePrBranch } from "@/lib/workspace/pr-url";
import type { PrBranchInfo } from "@/lib/workspace/pr-url";
import {
  buildReadmeContent,
  buildInitAnalyzeAndReadmePrompt,
  INIT_ANALYSIS_SCHEMA,
  buildPlannerPrompt,
  buildBestOfNFileReviewerPrompt,
  BEST_OF_N_REVIEW_SCHEMA,
} from "@/lib/templates";
import { runBestOfNFiles } from "./actions/best-of-n-files";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";
import { buildCommitSnapshotPhase } from "./actions/commit-snapshot";
import { buildCoordinateTodosPhase } from "./actions/coordinate-todos";
import { buildDiscoverConstraintsPhase } from "./actions/discover-constraints";
import { buildReviewTodosPhase } from "./actions/review-todos";

interface InitBestOfNOptions {
  bestOfN?: number;
  bestOfNConfirm?: boolean;
}

/** Reuse the same schema structure for reviewing README candidates. */
const INIT_REVIEW_SCHEMA = BEST_OF_N_REVIEW_SCHEMA;

/** Schema for README synthesizer output. */
const INIT_SYNTH_SCHEMA = {
  type: "object",
  properties: {
    readmeContent: {
      type: "string",
      description: "The synthesized README content combining the best parts from multiple candidates.",
    },
  },
  required: ["readmeContent"],
  additionalProperties: false,
} as const;

/** Build a prompt for synthesizing README from multiple candidates. */
function buildInitReadmeSynthesizerPrompt(input: {
  candidates: { label: string; files: { name: string; content: string }[] }[];
  baseCandidate: number;
}): string {
  const sections = input.candidates
    .map((c, i) => {
      const readme = c.files[0]?.content ?? "(no content)";
      return `### Candidate ${i + 1}: ${c.label}\n\`\`\`markdown\n${readme}\n\`\`\``;
    })
    .join("\n\n---\n\n");

  return `# Task: Synthesize README from Best-of-N Candidates

## Base Candidate: candidate-${input.baseCandidate}

## Candidates

${sections}

## Instructions

Create a synthesized README.md that combines the best parts from all candidates. Start with candidate-${input.baseCandidate} as the base and incorporate superior sections, details, or structure from the other candidates.

Output a JSON object with a single \`readmeContent\` field containing the full synthesized README.md content.

Maintain the overall structure of the base candidate while integrating improvements from others.`;
}

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
  bestOfNOptions?: InitBestOfNOptions,
): PipelinePhase[] {
  const bestOfN = bestOfNOptions?.bestOfN;
  const bestOfNConfirm = bestOfNOptions?.bestOfNConfirm;

  // Shared mutable state across pipeline phases
  let wsName = "";
  let wsPath = "";
  let analysis: (TaskAnalysis & { readmeContent?: string }) | null = null;
  const repoResults: SetupRepositoryResult[] = [];
  // Whether user opted into Best-of-N (set in Phase A, checked in Phase D)
  let useBestOfN = bestOfN != null && bestOfN >= 2;

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

        const runOnce = (label?: string) =>
          ctx.runChild(label ?? "Analyze & draft README", prompt, {
            jsonSchema: INIT_ANALYSIS_SCHEMA,
            stepType: STEP_TYPES.ANALYZE_README,
            appendSystemPromptFile: ensureGlobalSystemPrompt("init-readme"),
            onResultText: (text) => {
              analysis = parseAnalysis(text, description);
            },
          });

        // Best-of-N for README
        if (bestOfN && bestOfN >= 2) {
          // Confirmation ask (applies to both README and TODO Best-of-N)
          if (bestOfNConfirm) {
            const answers = await ctx.emitAsk([{
              question: `Best-of-N mode is enabled (${bestOfN} candidates). Use it for README creation and TODO planning?`,
              options: [
                { label: "Use Best-of-N", description: `Run ${bestOfN} candidates and compare results` },
                { label: "Normal execution", description: "Run single execution without Best-of-N" },
              ],
            }]);
            if (Object.values(answers)[0] !== "Use Best-of-N") {
              useBestOfN = false;
              ctx.emitStatus("Best-of-N skipped — running normal execution");
              return runOnce();
            }
          }

          ctx.emitStatus(`Running ${bestOfN} README candidates in parallel`);
          type Candidate = { label: string; analysis: TaskAnalysis & { readmeContent?: string } };

          // Collect parsed analyses per candidate via onResultText callbacks
          const candidateAnalyses = new Map<string, (TaskAnalysis & { readmeContent?: string }) | null>();
          const children = Array.from({ length: bestOfN }, (_, i) => {
            const label = `candidate-${i + 1}`;
            return {
              label: `${label}: Analyze & draft README`,
              prompt,
              jsonSchema: INIT_ANALYSIS_SCHEMA as Record<string, unknown>,
              stepType: STEP_TYPES.ANALYZE_README,
              appendSystemPromptFile: ensureGlobalSystemPrompt("init-readme"),
              onResultText: (text: string) => {
                candidateAnalyses.set(label, parseAnalysis(text, description));
              },
            };
          });

          const results = await ctx.runChildGroup(children);
          const candidates: Candidate[] = [];
          for (let i = 0; i < results.length; i++) {
            const label = `candidate-${i + 1}`;
            const candidateAnalysis = candidateAnalyses.get(label);
            ctx.emitStatus(`[${label}] ${results[i] ? "Completed" : "Failed"}`);
            if (results[i] && candidateAnalysis) {
              candidates.push({ label, analysis: candidateAnalysis });
            }
          }

          if (candidates.length === 0) {
            ctx.emitResult("**Best-of-N README: All candidates failed.**");
            return false;
          }

          if (candidates.length === 1) {
            analysis = candidates[0].analysis;
            ctx.emitStatus(`Only one candidate succeeded (${candidates[0].label}) — auto-selected`);
            return true;
          }

          // Run AI reviewer to select or synthesize
          ctx.emitStatus(`Running AI reviewer to compare ${candidates.length} README candidates`);
          const reviewCandidates = candidates.map((c) => ({
            label: c.label,
            files: [{ name: "README.md", content: c.analysis.readmeContent ?? "(no content)" }],
          }));
          const reviewPrompt = buildBestOfNFileReviewerPrompt({
            operationType: "init-readme",
            candidates: reviewCandidates,
          });

          let reviewResultText: string | undefined;
          const reviewOk = await ctx.runChild("Best-of-N README Reviewer", reviewPrompt, {
            jsonSchema: INIT_REVIEW_SCHEMA as Record<string, unknown>,
            appendSystemPromptFile: ensureGlobalSystemPrompt("best-of-n-file-reviewer"),
            onResultText: (text) => { reviewResultText = text; },
          });

          if (!reviewOk) {
            analysis = candidates[0].analysis;
            ctx.emitStatus("Reviewer failed — using first candidate");
            return true;
          }

          let action: "select" | "synthesize";
          let candidateNum: number;
          let reasoning: string;
          try {
            const decision = JSON.parse(reviewResultText ?? "{}");
            action = decision.action ?? "select";
            candidateNum = decision.candidate ?? 1;
            reasoning = decision.reasoning ?? "";
          } catch {
            analysis = candidates[0].analysis;
            ctx.emitStatus("Failed to parse reviewer result — using first candidate");
            return true;
          }

          ctx.emitResult(`**Best-of-N README Reviewer:** ${action} — ${reasoning}`);

          // When interactionLevel is "high", let user confirm or override
          if (interactionLevel === "high") {
            const confirmAnswers = await ctx.emitAsk([{
              question: `Reviewer chose to ${action} (candidate-${candidateNum}). Accept?`,
              options: [
                { label: "Accept", description: `Accept reviewer's ${action} decision` },
                ...candidates.map((c) => ({
                  label: `Override: pick ${c.label}`,
                  description: `Use ${c.label}'s README instead`,
                })),
              ],
            }]);
            const confirmAnswer = Object.values(confirmAnswers)[0];
            if (confirmAnswer && confirmAnswer !== "Accept") {
              const match = confirmAnswer.match(/Override: pick candidate-(\d+)/);
              if (match) {
                const overrideIdx = parseInt(match[1], 10) - 1;
                const selected = candidates[overrideIdx] ?? candidates[0];
                analysis = selected.analysis;
                ctx.emitStatus(`Human override: applied ${selected.label}`);
                return true;
              }
            }
          }

          if (action === "select") {
            const selected = candidates[candidateNum - 1] ?? candidates[0];
            analysis = selected.analysis;
            ctx.emitStatus(`Reviewer selected ${selected.label}`);
            return true;
          }

          // Synthesize: run a synthesizer child that outputs merged README content
          ctx.emitStatus("Running synthesizer to merge README candidates");
          const baseAnalysis = candidates[candidateNum - 1]?.analysis ?? candidates[0].analysis;
          const synthPrompt = buildInitReadmeSynthesizerPrompt({
            candidates: reviewCandidates,
            baseCandidate: candidateNum,
          });

          let synthResultText: string | undefined;
          const synthOk = await ctx.runChild("Best-of-N README Synthesizer", synthPrompt, {
            jsonSchema: INIT_SYNTH_SCHEMA as Record<string, unknown>,
            appendSystemPromptFile: ensureGlobalSystemPrompt("best-of-n-synthesizer"),
            onResultText: (text) => { synthResultText = text; },
          });

          if (synthOk && synthResultText) {
            try {
              const result = JSON.parse(synthResultText);
              analysis = { ...baseAnalysis, readmeContent: result.readmeContent };
              ctx.emitStatus("Synthesized README applied");
            } catch {
              analysis = baseAnalysis;
              ctx.emitStatus("Failed to parse synthesizer result — using base candidate");
            }
          } else {
            analysis = baseAnalysis;
            ctx.emitStatus("Synthesizer failed — using base candidate");
          }
          return true;
        }

        // Normal execution (no Best-of-N)
        return runOnce();
      },
    },
    // Phase B: Read analysis result, create workspace, copy README, setup repos
    // No retries: retrying would create duplicate workspaces since Phase B is not idempotent
    {
      kind: "function",
      label: "Setup workspace",
      maxRetries: 0,
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
            const prInfo = resolvePrBranch(prUrl);
            prUrlMap.set(prUrl.repoPath, prInfo);
            ctx.emitStatus(`PR #${prUrl.prNumber}: ${prInfo.headBranch} → ${prInfo.baseBranch}${prInfo.isFork ? " (fork)" : ""}`);
          } catch (err) {
            ctx.emitStatus(`Warning: Failed to resolve PR ${prUrl.url}: ${err}`);
          }
        }

        if (analysis.repositories.length > 0) {
          for (const repoPath of analysis.repositories) {
            if (ctx.signal.aborted) return false;
            ctx.emitStatus(`Setting up repository: ${repoPath}`);
            const prInfo = prUrlMap.get(repoPath);
            try {
              const repoResult = prInfo
                ? setupRepository(wsName, repoPath, prInfo.baseBranch, ctx.emitStatus, prInfo.headBranch)
                : setupRepository(wsName, repoPath, undefined, ctx.emitStatus);
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

        // Update README base branch info from resolved PR data
        if (prUrlMap.size > 0) {
          const readmePath = path.join(wsPath, "README.md");
          if (existsSync(readmePath)) {
            let readmeText = readFileSync(readmePath, "utf-8");
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
            writeFileSync(readmePath, readmeText, "utf-8");
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
    // Phase C: Discover repo constraints (lint/test/build) and append to README
    {
      kind: "function",
      label: "Discover repo constraints",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) => buildDiscoverConstraintsPhase({
        workspace: wsName,
        wsPath,
        repos: repoResults.map((r) => ({
          repoName: r.repoName,
          worktreePath: r.worktreePath,
        })),
      }).fn(ctx),
    },
    // Phase D: Plan TODOs for each repo (parallel, with optional Best-of-N)
    {
      kind: "function",
      label: "Plan TODO items",
      timeoutMs: 60 * 60 * 1000, // 1 hour — may wait for human when Best-of-N
      fn: async (ctx) => {
        if (analysis?.taskType === "review" || analysis?.taskType === "research") {
          ctx.emitStatus(`${analysis?.taskType === "review" ? "Review" : "Research"} workspace — skipping TODO planning`);
          return true;
        }

        const { content: readmeContent, meta } = await readWorkspaceReadme(wsPath);

        if (repoResults.length === 0) {
          ctx.emitResult("No repositories configured — skipping TODO planning.");
          return true;
        }

        const plannerAgent = meta.taskType === "research" ? "research-planner" : "planner";
        const buildPlannerChildren = (todoOutputDir?: string, addDirsOverride?: string[]) =>
          repoResults.map((repo) => ({
            label: `plan-${repo.repoName}`,
            stepType: STEP_TYPES.PLAN_TODO,
            prompt: buildPlannerPrompt({
              workspaceName: wsName,
              repoPath: repo.repoPath,
              repoName: repo.repoName,
              readmeContent,
              worktreePath: repo.worktreePath,
              taskType: meta.taskType,
              interactive: interactionLevel === "high",
              todoOutputDir,
            }),
            addDirs: addDirsOverride ?? [wsPath],
            appendSystemPromptFile: ensureSystemPrompt(wsPath, plannerAgent),
          }));

        const cleanup = () => {
          const templatePath = path.join(wsPath, "templates", "TODO-template.md");
          if (existsSync(templatePath)) {
            unlinkSync(templatePath);
          }
        };

        // Best-of-N for TODO planning
        if (useBestOfN && bestOfN && bestOfN >= 2) {
          const todoFiles = repoResults.map((r) => path.join(wsPath, `TODO-${r.repoName}.md`));
          // Include template so each candidate dir has it for the planner to read
          const templatePath = path.join(wsPath, "templates", "TODO-template.md");
          const filesToCapture = existsSync(templatePath)
            ? [...todoFiles, templatePath]
            : todoFiles;

          const result = await runBestOfNFiles({
            ctx,
            n: bestOfN,
            operationType: "plan-todo",
            filesToCapture,
            buildChildren: (candidateDir) =>
              buildPlannerChildren(
                candidateDir,
                [candidateDir, ...repoResults.map((r) => r.worktreePath)],
              ),
            interactionLevel,
          });

          cleanup();
          return result;
        }

        // Normal execution
        const children = buildPlannerChildren();
        ctx.emitStatus(`Planning TODOs for ${children.length} repositories`);
        const results = await ctx.runChildGroup(children);
        const allSuccess = results.every(Boolean);
        ctx.emitStatus(
          `Planning complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
        );
        cleanup();
        return allSuccess;
      },
    },
    // Phase E: Coordinate TODOs across repos (single, skip for single repo)
    // Delegates to shared action at runtime when wsName/repoResults are populated
    {
      kind: "function",
      label: "Coordinate TODOs",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) => {
        if (analysis?.taskType === "review" || analysis?.taskType === "research") {
          ctx.emitStatus(`${analysis?.taskType === "review" ? "Review" : "Research"} workspace — skipping TODO coordination`);
          return Promise.resolve(true);
        }
        return buildCoordinateTodosPhase({
          workspace: wsName,
          wsPath,
          repoNames: repoResults.map((r) => r.repoName),
        }).fn(ctx);
      },
    },
    // Phase F: Review TODOs (parallel, per repo)
    {
      kind: "function",
      label: "Review TODOs",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) => {
        if (analysis?.taskType === "review" || analysis?.taskType === "research") {
          ctx.emitStatus(`${analysis?.taskType === "review" ? "Review" : "Research"} workspace — skipping TODO review`);
          return Promise.resolve(true);
        }
        return buildReviewTodosPhase({
          workspace: wsName,
          wsPath,
          repos: repoResults.map((r) => ({
            repoName: r.repoName,
            worktreePath: r.worktreePath,
          })),
        }).fn(ctx);
      },
    },
    // Phase G: Commit workspace snapshot
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
