import { getReviewSessions, getReviewDetail, getTodos, getReadme } from "@/lib/workspace/reader";
import { stripCompletedTodosFromWorkspace } from "@/lib/workspace/todo-cleanup";
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
  reason: string;
  fixableIssues: string[];
}

async function runAutonomousGate(
  ctx: PhaseFunctionContext,
  workspace: string,
  loopIteration: number,
  maxLoops: number,
): Promise<AutonomousGateResult> {
  // Final iteration: skip AI call
  if (loopIteration >= maxLoops) {
    return { shouldLoop: false, reason: "Maximum loop iterations reached", fixableIssues: [] };
  }

  // Check review results
  const sessions = await getReviewSessions(workspace);
  if (sessions.length === 0) {
    return { shouldLoop: false, reason: "No review sessions found", fixableIssues: [] };
  }

  const latest = sessions[0];

  // Always let AI evaluate — even warnings/suggestions may be worth fixing
  const reviewDetail = await getReviewDetail(workspace, latest.timestamp);
  if (!reviewDetail) {
    return { shouldLoop: false, reason: "Could not read review details", fixableIssues: [] };
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
    return { shouldLoop: false, reason: "Gate execution failed", fixableIssues: [] };
  }

  // Parse result
  try {
    const parsed = JSON.parse(resultText) as AutonomousGateResult;
    if (typeof parsed.shouldLoop !== "boolean") {
      return { shouldLoop: false, reason: "Invalid gate response", fixableIssues: [] };
    }
    return {
      shouldLoop: parsed.shouldLoop,
      reason: parsed.reason ?? "",
      fixableIssues: Array.isArray(parsed.fixableIssues) ? parsed.fixableIssues : [],
    };
  } catch {
    return { shouldLoop: false, reason: "Failed to parse gate response", fixableIssues: [] };
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
  /** For resume: pre-generate this many cycle phases so resumeFrom index is valid. */
  resumeCycleCount?: number;
  /** For resume: append a Create PR phase to match the saved phase structure. */
  resumeWithCreatePr?: boolean;
}): PipelinePhase[] {
  const { startWith, description, workspace, instruction, draft, interactionLevel, repo } = input;
  const maxLoops = input.maxLoops ?? DEFAULT_MAX_LOOPS;
  const phases: PipelinePhase[] = [];
  const skip = { skipAskUserQuestion: true } as const;

  // ------------------------------------------------------------------
  // Leading phases: init, update-todo, or skip straight to execute
  // ------------------------------------------------------------------

  if (startWith === "init") {
    const initPhases = buildInitPipeline(description ?? "", interactionLevel);
    phases.push(...initPhases);
  } else if (startWith === "update-todo") {
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
  // Autonomous cycle: each iteration is its own dynamic phase
  // ------------------------------------------------------------------

  // Helper to build a single cycle phase (Execute → Review → Gate → UpdateTODO)
  function buildCyclePhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}`,
      timeoutMs: 50 * 60 * 1000,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;

        // Execute
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot execute");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Executing workspace: ${ws}`);

        const execPhases = await buildExecutePipeline({ workspace: ws, repository: repo });
        const execOk = await runSubPhases(ctx, execPhases, skip);
        if (!execOk) return false;

        // Review
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Reviewing workspace: ${ws}`);
        const reviewPhases = await buildReviewPipeline({ workspace: ws, repository: repo });
        const reviewOk = await runSubPhases(ctx, reviewPhases, skip);
        if (!reviewOk) return false;

        // AI Gate
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Evaluating review results`);
        const gateResult = await runAutonomousGate(ctx, ws, loopNumber, maxLoops);
        ctx.emitResult(
          `**Gate decision (cycle ${loopNumber}/${maxLoops})**: ${gateResult.shouldLoop ? "Continue" : "Proceed to PR"} — ${gateResult.reason}` +
            (gateResult.fixableIssues.length > 0
              ? `\n- ${gateResult.fixableIssues.join("\n- ")}`
              : ""),
        );

        if (!gateResult.shouldLoop) {
          // Append Create PR as the next phase
          ctx.appendPhases([buildCreatePrPhase()]);
          return true;
        }

        // Update TODOs with specific issues
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Updating TODOs for next iteration`);
        const stripped = await stripCompletedTodosFromWorkspace(ws, repo);
        if (stripped.length > 0) {
          ctx.emitStatus(`Removed completed TODO items from: ${stripped.join(", ")}`);
        }
        const updateInstruction =
          gateResult.fixableIssues.length > 0
            ? `Fix the following issues found in review:\n${gateResult.fixableIssues.map((i) => `- ${i}`).join("\n")}`
            : DEFAULT_UPDATE_TODO_INSTRUCTION;
        const updatePhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: updateInstruction,
          repo,
          interactionLevel,
        });
        const updateOk = await runSubPhases(ctx, updatePhases, skip);
        if (!updateOk) return false;

        // Append next cycle phase
        ctx.appendPhases([buildCyclePhase(loopNumber + 1)]);
        return true;
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
  // For resume, pre-generate enough cycle phases so the resumeFrom index is valid.
  const cycleCount = input.resumeCycleCount ?? 1;
  for (let i = 1; i <= cycleCount; i++) {
    phases.push(buildCyclePhase(i));
  }

  // For resume: if "Create PR" was dynamically appended before crash, include it
  if (input.resumeWithCreatePr) {
    phases.push(buildCreatePrPhase());
  }

  return phases;
}
