import { getReviewSessions, getReviewDetail, getTodos, getReadme } from "@/lib/workspace/reader";
import { triggerWorkspaceSuggestion } from "@/lib/suggest-workspace";
import { buildInitPipeline } from "./init";
import { buildExecutePipeline } from "./execute";
import { buildReviewPipeline } from "./review";
import { buildCreatePrPipeline } from "./create-pr";
import { buildUpdateTodoPipeline } from "./update-todo";
import { runSubPhases } from "./actions/run-sub-phases";
import { resolveWorkspace } from "./actions/resolve-workspace";
import { buildAutonomousGatePrompt, AUTONOMOUS_GATE_SCHEMA } from "@/lib/templates/prompts/autonomous-gate";
import { getWorkspaceDir } from "@/lib/config";
import path from "node:path";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

const DEFAULT_MAX_LOOPS = 3;

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
  let resultText = "";
  const ok = await ctx.runChild("Autonomous Gate", prompt, {
    jsonSchema: AUTONOMOUS_GATE_SCHEMA,
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
  // Autonomous cycle: Execute → Review → Gate → (loop or CreatePR)
  // ------------------------------------------------------------------

  phases.push({
    kind: "function",
    label: "Autonomous cycle",
    timeoutMs: maxLoops * 50 * 60 * 1000,
    fn: async (ctx) => {
      let loopCount = 0;

      while (loopCount < maxLoops) {
        if (ctx.signal.aborted) return false;
        loopCount++;

        // Execute
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot execute");
          return false;
        }
        ctx.emitStatus(`Autonomous cycle ${loopCount}/${maxLoops}: Executing workspace: ${ws}`);

        const execPhases = await buildExecutePipeline({ workspace: ws, repository: repo });
        const execOk = await runSubPhases(ctx, execPhases, skip);
        if (!execOk) return false;

        // Review
        ctx.emitStatus(`Autonomous cycle ${loopCount}/${maxLoops}: Reviewing workspace: ${ws}`);
        const reviewPhases = await buildReviewPipeline({ workspace: ws, repository: repo });
        const reviewOk = await runSubPhases(ctx, reviewPhases, skip);
        if (!reviewOk) return false;

        // AI Gate
        ctx.emitStatus(`Autonomous cycle ${loopCount}/${maxLoops}: Evaluating review results`);
        const gateResult = await runAutonomousGate(ctx, ws, loopCount, maxLoops);
        ctx.emitResult(
          `**Gate decision (loop ${loopCount}/${maxLoops})**: ${gateResult.shouldLoop ? "Loop" : "Proceed to PR"} — ${gateResult.reason}` +
            (gateResult.fixableIssues.length > 0
              ? `\n- ${gateResult.fixableIssues.join("\n- ")}`
              : ""),
        );

        if (!gateResult.shouldLoop) {
          triggerWorkspaceSuggestion(ws, ctx.operationId, "autonomous-gate");
          break;
        }

        // Loop: UpdateTODO with specific issues
        ctx.emitStatus(`Autonomous cycle ${loopCount}/${maxLoops}: Updating TODOs for next iteration`);
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
      }

      // Create PR
      const ws = resolveWorkspace(ctx.operationId, workspace);
      ctx.emitStatus(`Creating PR for workspace: ${ws}`);
      const prPhases = await buildCreatePrPipeline({
        workspace: ws,
        draft: draft ?? false,
        repository: repo,
      });
      return runSubPhases(ctx, prPhases, skip);
    },
  });

  return phases;
}
