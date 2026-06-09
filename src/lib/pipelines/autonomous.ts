import { getReviewSessions, getReviewDetail, getTodos, getReadme } from "@/lib/workspace/reader";
import { stripCompletedTodosFromWorkspace } from "@/lib/workspace/todo-cleanup";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { syncReadmeRepositories } from "./actions/ensure-repositories";
import { buildInitTodoAnalysisPhases } from "./actions/init-todo-analysis";
import { buildInitPipeline } from "./init";
import { buildExecutePipeline } from "./execute";
import { buildReviewPipeline } from "./review";
import { buildCreatePrPipeline } from "./create-pr";
import { buildUpdateTodoPipeline } from "./update-todo";
import { runSubPhases } from "./actions/run-sub-phases";
import { resolveWorkspace } from "./actions/resolve-workspace";
import { buildAutonomousGatePrompt, AUTONOMOUS_GATE_SCHEMA } from "@/lib/templates/prompts/autonomous-gate";
import { getWorkspaceDir } from "@/lib/config";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import path from "node:path";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

const DEFAULT_MAX_LOOPS = 10;

const DEFAULT_UPDATE_TODO_INSTRUCTION =
  "Update TODO item statuses to reflect current implementation progress.";

interface AutonomousGateResult {
  shouldLoop: boolean;
  giveUp: boolean;
  reason: string;
  fixableIssues: string[];
}

async function runAutonomousGate(
  ctx: PhaseFunctionContext,
  workspace: string,
  loopIteration: number,
  maxLoops: number,
  previousGateResults?: { cycle: number; reason: string; fixableIssues: string[] }[],
): Promise<AutonomousGateResult> {
  // Final iteration: skip AI call
  if (loopIteration >= maxLoops) {
    return { shouldLoop: false, giveUp: false, reason: "Maximum loop iterations reached", fixableIssues: [] };
  }

  // Check review results
  const sessions = await getReviewSessions(workspace);
  if (sessions.length === 0) {
    return { shouldLoop: false, giveUp: false, reason: "No review sessions found", fixableIssues: [] };
  }

  const latest = sessions[0];

  // Always let AI evaluate — even warnings/suggestions may be worth fixing
  const reviewDetail = await getReviewDetail(workspace, latest.timestamp);
  if (!reviewDetail) {
    return { shouldLoop: false, giveUp: false, reason: "Could not read review details", fixableIssues: [] };
  }

  // Get TODO files
  const todoSummaries = await getTodos(workspace);
  const todoFiles: { repoName: string; content: string }[] = [];
  for (const todo of todoSummaries) {
    const todoPath = path.join(getWorkspaceDir(), workspace, todo.filename);
    try {
      const content = await Bun.file(todoPath).text();
      todoFiles.push({ repoName: todo.repoName, content });
    } catch {
      // skip unreadable TODO files
    }
  }

  // Get README
  const readmeContent = (await getReadme(workspace)) ?? "";

  // Build gate prompt
  const prompt = buildAutonomousGatePrompt({
    workspaceName: workspace,
    reviewSummary: reviewDetail.summary,
    reviewFiles: reviewDetail.files,
    todoFiles,
    readmeContent,
    loopIteration,
    maxLoops,
    previousGateResults,
  });

  // Run AI gate
  const wsPath = path.join(getWorkspaceDir(), workspace);
  let resultText = "";
  const ok = await ctx.runChild("Autonomous Gate", prompt, {
    jsonSchema: AUTONOMOUS_GATE_SCHEMA,
    stepType: STEP_TYPES.AUTONOMOUS_GATE,
    appendSystemPromptFile: ensureSystemPrompt(wsPath, "autonomous-gate"),
    onResultText: (text) => { resultText = text; },
    skipAskUserQuestion: true,
  });

  if (!ok || !resultText) {
    return { shouldLoop: false, giveUp: false, reason: "Gate execution failed", fixableIssues: [] };
  }

  // Parse result
  try {
    const parsed = JSON.parse(resultText) as AutonomousGateResult;
    if (typeof parsed.shouldLoop !== "boolean") {
      return { shouldLoop: false, giveUp: false, reason: "Invalid gate response", fixableIssues: [] };
    }
    return {
      shouldLoop: parsed.shouldLoop,
      giveUp: parsed.giveUp === true,
      reason: parsed.reason ?? "",
      fixableIssues: Array.isArray(parsed.fixableIssues) ? parsed.fixableIssues : [],
    };
  } catch {
    return { shouldLoop: false, giveUp: false, reason: "Failed to parse gate response", fixableIssues: [] };
  }
}

export function buildAutonomousPipeline(input: {
  startWith: "init" | "update-todo" | "execute";
  description?: string;
  workspace?: string;
  instruction?: string;
  draft?: boolean;
  interactionLevel?: InteractionLevel;
  repo?: string;
  maxLoops?: number;
  /** For resume: pre-generate cycle phases matching the saved structure. */
  resumeCycles?: { cycle: number; hasUpdateTodo: boolean }[];
  /** For resume: append a Create PR phase to match the saved phase structure. */
  resumeWithCreatePr?: boolean;
  /** For resume: prepend the Ensure repositories phase if it was in the saved structure. */
  resumeWithEnsureRepos?: boolean;
  /** For resume: prepend the Ensure TODOs phase if it was in the saved structure. */
  resumeWithEnsureTodos?: boolean;
}): PipelinePhase[] {
  const { startWith, description, workspace, instruction, draft, interactionLevel, repo } = input;
  const maxLoops = input.maxLoops ?? DEFAULT_MAX_LOOPS;
  const phases: PipelinePhase[] = [];
  const skip = { skipAskUserQuestion: true } as const;
  const gateHistory: { cycle: number; reason: string; fixableIssues: string[] }[] = [];

  // ------------------------------------------------------------------
  // Leading phases: init, update-todo, or skip straight to execute
  // ------------------------------------------------------------------

  function buildEnsureRepositoriesPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Ensure repositories",
      timeoutMs: 10 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot ensure repositories");
          return false;
        }

        const res = await syncReadmeRepositories(ws, ctx.emitStatus, ctx.signal);

        if (res.readError) {
          ctx.emitResult(`Failed to read README: ${res.readError}`);
          return false;
        }

        if (res.metaRepoCount === 0) {
          if (res.existingCount > 0) {
            // Workspace has worktrees but README is missing entries — proceed,
            // executor will use what's on disk.
            ctx.emitStatus(
              `README has no repository entries, but ${res.existingCount} worktree(s) on disk`,
            );
            return true;
          }
          ctx.emitResult(
            "README has no repository entries. Add repositories to README.md and retry.",
          );
          return false;
        }

        if (res.stillMissing.length > 0) {
          ctx.emitResult(
            `Failed to set up: ${res.stillMissing.join(", ")}. Check README.md and try again.`,
          );
          return false;
        }

        if (res.setUp.length > 0) {
          ctx.emitResult(
            `Set up ${res.setUp.length} repositor${res.setUp.length === 1 ? "y" : "ies"}: ${res.setUp.join(", ")}`,
          );
        } else {
          ctx.emitStatus(
            `All ${res.metaRepoCount} README repositor${res.metaRepoCount === 1 ? "y" : "ies"} already set up`,
          );
        }
        return true;
      },
    };
  }

  function buildEnsureTodosPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Ensure TODOs",
      timeoutMs: 60 * 60 * 1000, // Plan TODO sub-phase may wait for human interaction
      maxRetries: 0,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot ensure TODOs");
          return false;
        }

        const wsPath = path.join(getWorkspaceDir(), ws);
        const repos = listWorkspaceRepos(ws);
        if (repos.length === 0) {
          ctx.emitResult(
            "No repositories in workspace — cannot plan TODOs. Run Ensure repositories first.",
          );
          return false;
        }

        const existing = await getTodos(ws);
        const existingTodoRepos = new Set(existing.map((t) => t.repoName));
        const missing = repos.filter((r) => !existingTodoRepos.has(r.repoName));

        if (missing.length === 0) {
          ctx.emitStatus(
            `TODO files present for all ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`,
          );
          return true;
        }

        let taskType = "";
        try {
          const { meta } = await readWorkspaceReadme(wsPath);
          taskType = meta.taskType;
        } catch (err) {
          ctx.emitStatus(`Warning: failed to read README: ${err}`);
        }

        ctx.emitStatus(
          `Missing TODO files for ${missing.length} repositor${missing.length === 1 ? "y" : "ies"}: ${missing.map((r) => r.repoName).join(", ")}`,
        );

        const subPhases = buildInitTodoAnalysisPhases({
          wsName: () => ws,
          wsPath: () => wsPath,
          repos: () => missing.map((r) => ({
            repoPath: r.repoPath,
            repoName: r.repoName,
            worktreePath: r.worktreePath,
          })),
          taskType: () => taskType,
          interactionLevel,
          commitMessage: "Recover: workspace TODO analysis completed",
          commitResultMessage: `Workspace **${ws}** TODO analysis recovered.`,
        });

        return runSubPhases(ctx, subPhases, skip);
      },
    };
  }

  if (startWith === "init") {
    const initPhases = buildInitPipeline(description ?? "", interactionLevel);
    phases.push(...initPhases);
  } else {
    // Prepend salvage phases for non-init paths.
    // On resume, only include them if the saved phase structure had them.
    if (!input.resumeCycles || input.resumeWithEnsureRepos) {
      phases.push(buildEnsureRepositoriesPhase());
    }
    if (!input.resumeCycles || input.resumeWithEnsureTodos) {
      phases.push(buildEnsureTodosPhase());
    }
  }

  if (startWith === "update-todo") {
    phases.push({
      kind: "function",
      label: "Update TODOs",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        const ws = workspace!;
        const stripped = await stripCompletedTodosFromWorkspace(ws, repo);
        if (stripped.length > 0) {
          ctx.emitStatus(`Removed completed TODO items from: ${stripped.join(", ")}`);
        }
        const subPhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: instruction || DEFAULT_UPDATE_TODO_INSTRUCTION,
          repo,
          interactionLevel,
        });
        return runSubPhases(ctx, subPhases, skip);
      },
    });
  }

  // ------------------------------------------------------------------
  // Autonomous cycle: each step is its own top-level phase
  // ------------------------------------------------------------------

  function buildCycleExecutePhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Execute`,
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot execute");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Executing workspace: ${ws}`);
        const execPhases = await buildExecutePipeline({ workspace: ws, repository: repo });
        return runSubPhases(ctx, execPhases, skip);
      },
    };
  }

  function buildCycleReviewPhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Review`,
      timeoutMs: 15 * 60 * 1000,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot review");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Reviewing workspace: ${ws}`);
        const reviewPhases = await buildReviewPipeline({ workspace: ws, repository: repo });
        return runSubPhases(ctx, reviewPhases, skip);
      },
    };
  }

  function buildCycleGatePhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Gate`,
      timeoutMs: 10 * 60 * 1000,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot evaluate");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Evaluating review results`);
        const gateResult = await runAutonomousGate(ctx, ws, loopNumber, maxLoops, gateHistory);
        gateHistory.push({ cycle: loopNumber, reason: gateResult.reason, fixableIssues: gateResult.fixableIssues });

        const decisionLabel = gateResult.giveUp
          ? "Give up"
          : gateResult.shouldLoop
            ? "Continue"
            : "Proceed to PR";
        ctx.emitResult(
          `**Gate decision (cycle ${loopNumber}/${maxLoops})**: ${decisionLabel} — ${gateResult.reason}` +
            (gateResult.fixableIssues.length > 0
              ? `\n- ${gateResult.fixableIssues.join("\n- ")}`
              : ""),
        );

        if (gateResult.giveUp) {
          return true;
        }

        if (!gateResult.shouldLoop) {
          ctx.appendPhases([buildCreatePrPhase()]);
          return true;
        }

        // Append: Update TODO for this cycle + next cycle's 3 phases
        ctx.appendPhases([
          buildCycleUpdateTodoPhase(loopNumber, gateResult.fixableIssues),
          buildCycleExecutePhase(loopNumber + 1),
          buildCycleReviewPhase(loopNumber + 1),
          buildCycleGatePhase(loopNumber + 1),
        ]);
        return true;
      },
    };
  }

  function buildCycleUpdateTodoPhase(loopNumber: number, fixableIssues: string[]): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Update TODO`,
      timeoutMs: 15 * 60 * 1000,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot update TODOs");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Updating TODOs for next iteration`);
        const stripped = await stripCompletedTodosFromWorkspace(ws, repo);
        if (stripped.length > 0) {
          ctx.emitStatus(`Removed completed TODO items from: ${stripped.join(", ")}`);
        }
        const updateInstruction =
          fixableIssues.length > 0
            ? `Fix the following issues found in review:\n${fixableIssues.map((i) => `- ${i}`).join("\n")}`
            : DEFAULT_UPDATE_TODO_INSTRUCTION;
        const updatePhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: updateInstruction,
          repo,
          interactionLevel,
        });
        return runSubPhases(ctx, updatePhases, skip);
      },
    };
  }

  // Helper to build the Create PR phase
  function buildCreatePrPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Create PR",
      timeoutMs: 15 * 60 * 1000,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Creating PR for workspace: ${ws}`);
        const prPhases = await buildCreatePrPipeline({
          workspace: ws,
          draft: draft !== false,
          repository: repo,
        });
        return runSubPhases(ctx, prPhases, skip);
      },
    };
  }

  // Start with cycle 1 — subsequent cycles are appended dynamically by gate logic.
  // For resume, pre-generate all cycle phases so the resumeFrom index is valid.
  if (input.resumeCycles) {
    for (const { cycle, hasUpdateTodo } of input.resumeCycles) {
      phases.push(buildCycleExecutePhase(cycle));
      phases.push(buildCycleReviewPhase(cycle));
      phases.push(buildCycleGatePhase(cycle));
      if (hasUpdateTodo) {
        phases.push(buildCycleUpdateTodoPhase(cycle, []));
      }
    }
  } else {
    phases.push(buildCycleExecutePhase(1));
    phases.push(buildCycleReviewPhase(1));
    phases.push(buildCycleGatePhase(1));
  }

  // For resume: if "Create PR" was dynamically appended before crash, include it
  if (input.resumeWithCreatePr) {
    phases.push(buildCreatePrPhase());
  }

  return phases;
}
