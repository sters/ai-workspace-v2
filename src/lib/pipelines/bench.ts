/**
 * A bench: one step's child, built from the workspace as the pipeline would
 * build it, run under several model / effort pairings so their cost and their
 * agreement with a reference pairing can be compared. Nothing it runs writes
 * to the workspace, and its verdicts are recorded, not applied.
 */

import { BENCH_STEPS } from "@/lib/bench/steps";
import { insertBenchRun } from "@/lib/db/bench-runs";
import type { BenchAttempt } from "@/lib/bench/summary";
import type { ClaudeEffort, ClaudeModel } from "@/types/claude";
import type { GroupChild, PipelinePhase } from "@/types/pipeline";

export interface BenchInput {
  workspace: string;
  step: string;
  repo?: string;
  configs: { model: ClaudeModel; effort: ClaudeEffort }[];
  /** `<model>/<effort>` of one of `configs`. */
  reference: string;
  repeats: number;
}

/**
 * What a bench child may use. It replaces the Edit / Write grant the pipeline's
 * `addDirs` would add, so a verifier that reads a review directory cannot
 * change it; git is limited to commands that only read.
 */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];

export const configKey = (c: { model: string; effort: string }) => `${c.model}/${c.effort}`;

export function buildBenchPipeline(input: BenchInput): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Bench",
      timeoutMs: 30 * 60 * 1000,
      // A retry would pay for every pairing again.
      maxRetries: 0,
      fn: async (ctx) => {
        const step = BENCH_STEPS.get(input.step);
        if (!step) {
          ctx.emitResult(`Unknown bench step: ${input.step}`);
          return false;
        }
        const built = await step.build(input.workspace, input.repo);
        if ("error" in built) {
          ctx.emitResult(built.error);
          return false;
        }

        const texts = new Map<string, string>();
        const children: GroupChild[] = input.configs.flatMap((config) =>
          Array.from({ length: input.repeats }, (_, i) => {
            const label = `${configKey(config)} #${i + 1}`;
            return {
              ...built,
              label,
              model: config.model,
              effort: config.effort,
              allowedTools: READ_ONLY_TOOLS,
              onResultText: (text: string) => { texts.set(label, text); },
            };
          }),
        );

        ctx.emitStatus(`Running ${children.length} attempts of ${step.label}`);
        const results = await ctx.runChildGroup(children);

        const attempts: BenchAttempt[] = children.map((c, i) => ({
          label: c.label,
          config: configKey({ model: c.model!, effort: c.effort! }),
          ok: results[i] && texts.has(c.label),
          text: texts.get(c.label) ?? "",
        }));
        insertBenchRun({
          operationId: ctx.operationId,
          workspace: input.workspace,
          step: input.step,
          repo: input.repo ?? null,
          reference: input.reference,
          attempts,
        });
        ctx.emitResult(`Bench finished: ${attempts.filter((a) => a.ok).length}/${attempts.length} attempts answered`);
        return true;
      },
    },
  ];
}
