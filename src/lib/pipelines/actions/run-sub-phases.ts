import type { PipelinePhase, PhaseFunctionContext, RunChildOptions } from "@/types/pipeline";

/** Options merged into every child call within runSubPhases. */
export type SubPhaseOptions = Pick<RunChildOptions, "skipAskUserQuestion">;

/**
 * Run sub-pipeline phases within a single function phase context.
 * Handles single, group, and function phase kinds.
 * When `extra` is provided, its fields are merged into every runChild/runChildGroup call.
 */
export async function runSubPhases(
  ctx: PhaseFunctionContext,
  phases: PipelinePhase[],
  extra?: SubPhaseOptions,
): Promise<boolean> {
  for (const phase of phases) {
    if (ctx.signal.aborted) return false;

    if (phase.kind === "single") {
      ctx.emitStatus(`Running: ${phase.label}`);
      const ok = await ctx.runChild(phase.label, phase.prompt, {
        cwd: phase.cwd,
        addDirs: phase.addDirs,
        allowedTools: phase.allowedTools,
        stepType: phase.stepType,
        model: phase.model,
        appendSystemPromptFile: phase.appendSystemPromptFile,
        ...extra,
      });
      if (!ok) return false;
    } else if (phase.kind === "group") {
      ctx.emitStatus(
        `Running parallel: ${phase.children.map((c) => c.label).join(", ")}`,
      );
      const children = extra
        ? phase.children.map((c) => ({ ...c, ...extra }))
        : phase.children;
      const results = await ctx.runChildGroup(children);
      if (!results.every(Boolean)) return false;
    } else {
      ctx.emitStatus(`Running: ${phase.label}`);
      const ok = await phase.fn(ctx);
      if (!ok) return false;
    }
  }
  return true;
}
