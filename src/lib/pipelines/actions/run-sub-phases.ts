import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";

/**
 * Run sub-pipeline phases within a single function phase context.
 * Handles single, group, and function phase kinds.
 */
export async function runSubPhases(
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
