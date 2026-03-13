import { getOperation } from "@/lib/pipeline-manager";
import { getReviewSessions } from "@/lib/workspace/reader";
import { buildInitPipeline } from "./init";
import { buildExecutePipeline } from "./execute";
import { buildReviewPipeline } from "./review";
import { buildCreatePrPipeline } from "./create-pr";
import { buildUpdateTodoPipeline } from "./update-todo";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

type BatchMode =
  | "execute-review"
  | "execute-pr"
  | "execute-review-pr-gated"
  | "execute-review-pr";

const DEFAULT_UPDATE_TODO_INSTRUCTION =
  "Update TODO item statuses to reflect current implementation progress.";

/**
 * Run sub-pipeline phases within a single function phase context.
 * Handles single, group, and function phase kinds.
 */
async function runSubPhases(
  ctx: PhaseFunctionContext,
  phases: PipelinePhase[],
): Promise<boolean> {
  for (const phase of phases) {
    if (ctx.signal.aborted) return false;

    if (phase.kind === "single") {
      ctx.emitStatus(`Running: ${phase.label}`);
      const ok = await ctx.runChild(phase.label, phase.prompt, {
        cwd: phase.cwd,
        addDirs: phase.addDirs,
      });
      if (!ok) return false;
    } else if (phase.kind === "group") {
      ctx.emitStatus(
        `Running parallel: ${phase.children.map((c) => c.label).join(", ")}`,
      );
      const results = await ctx.runChildGroup(phase.children);
      if (!results.every(Boolean)) return false;
    } else {
      ctx.emitStatus(`Running: ${phase.label}`);
      const ok = await phase.fn(ctx);
      if (!ok) return false;
    }
  }
  return true;
}

/** Resolve the workspace name from the running operation. */
function resolveWorkspace(operationId: string, fallback?: string): string {
  const op = getOperation(operationId);
  return op?.workspace || fallback || "";
}

export function buildBatchPipeline(input: {
  mode: BatchMode;
  startWith: "init" | "update-todo" | "execute";
  description?: string;
  workspace?: string;
  instruction?: string;
  draft?: boolean;
  interactionLevel?: InteractionLevel;
  repo?: string;
}): PipelinePhase[] {
  const { mode, startWith, description, workspace, instruction, draft, interactionLevel, repo } = input;
  const phases: PipelinePhase[] = [];

  // ------------------------------------------------------------------
  // Leading phases: init, update-todo, or skip straight to execute
  // ------------------------------------------------------------------

  if (startWith === "init") {
    // Inline all init phases — they share closures for wsName etc.
    const initPhases = buildInitPipeline(description ?? "", interactionLevel);
    phases.push(...initPhases);
  } else if (startWith === "update-todo") {
    // update-todo: single phase built upfront
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
        });
        return runSubPhases(ctx, subPhases);
      },
    });
  }
  // startWith === "execute": no leading phase, jump straight to execute

  // ------------------------------------------------------------------
  // Execute phase (always present)
  // ------------------------------------------------------------------

  phases.push({
    kind: "function",
    label: "Execute",
    timeoutMs: 25 * 60 * 1000,
    fn: async (ctx) => {
      const ws = resolveWorkspace(ctx.operationId, workspace);
      if (!ws) {
        ctx.emitStatus("No workspace found — cannot execute");
        return false;
      }
      ctx.emitStatus(`Executing workspace: ${ws}`);
      const subPhases = await buildExecutePipeline({ workspace: ws });
      return runSubPhases(ctx, subPhases);
    },
  });

  // ------------------------------------------------------------------
  // Review phase (unless mode is execute-pr)
  // ------------------------------------------------------------------

  const includeReview = mode !== "execute-pr";
  if (includeReview) {
    phases.push({
      kind: "function",
      label: "Review",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Reviewing workspace: ${ws}`);
        const subPhases = await buildReviewPipeline({ workspace: ws });
        return runSubPhases(ctx, subPhases);
      },
    });
  }

  // ------------------------------------------------------------------
  // Gate check (only for execute-review-pr-gated)
  // ------------------------------------------------------------------

  let skipPr = false;

  if (mode === "execute-review-pr-gated") {
    phases.push({
      kind: "function",
      label: "Check review results",
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        const sessions = await getReviewSessions(ws);
        if (sessions.length === 0) {
          ctx.emitStatus("No review sessions found — skipping PR creation");
          skipPr = true;
          return true;
        }
        const latest = sessions[0]; // already sorted newest-first
        if (latest.critical > 0) {
          ctx.emitStatus(
            `Review found ${latest.critical} critical issue(s) — skipping PR creation`,
          );
          ctx.emitResult(
            `Review gate: **${latest.critical} critical issue(s)** detected. PR creation skipped.`,
          );
          skipPr = true;
        } else {
          ctx.emitStatus("Review passed — no critical issues, proceeding to PR");
        }
        return true;
      },
    });
  }

  // ------------------------------------------------------------------
  // Create PR phase (unless mode is execute-review)
  // ------------------------------------------------------------------

  const includePr = mode !== "execute-review";
  if (includePr) {
    phases.push({
      kind: "function",
      label: "Create PR",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        if (skipPr) {
          ctx.emitStatus("PR creation skipped due to review gate");
          return true;
        }
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Creating PR for workspace: ${ws}`);
        const subPhases = await buildCreatePrPipeline({
          workspace: ws,
          draft: draft ?? false,
        });
        return runSubPhases(ctx, subPhases);
      },
    });
  }

  return phases;
}
