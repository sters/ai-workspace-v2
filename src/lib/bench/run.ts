/**
 * A bench: one step's child, built from the workspace as the pipeline would
 * build it, run under several model / effort pairings. It returns each
 * attempt's answer and usage for a reader to compare — there is no automatic
 * scoring. It runs outside any operation, writes nothing to the workspace or
 * the database, and applies no verdict. `bin/bench.ts` is its command line.
 */

import { BENCH_STEPS } from "./steps";
import { summarizeBench } from "./summary";
import type { AttemptUsage, BenchAttempt, BenchConfigSummary } from "./summary";
import { runClaude } from "@/lib/claude";
import { parseRunUsage } from "@/lib/parsers/run-usage";
import { priceRun } from "@/lib/pricing";
import type { CacheTtl } from "@/lib/pricing";
import type { ClaudeEffort, ClaudeModel, RunClaudeOptions } from "@/types/claude";

export interface BenchInput {
  workspace: string;
  step: string;
  repo?: string;
  /** `<model>/<effort>` pairings. */
  configs: string[];
  repeats: number;
  concurrency?: number;
  /** Cache-write TTL the cost is priced at; defaults to `1h`, as on Run Costs. */
  ttl?: CacheTtl;
  onAttempt?: (attempt: BenchAttemptResult) => void;
}

export type BenchAttemptResult = BenchAttempt & AttemptUsage;

export interface BenchResult {
  step: string;
  repo?: string;
  /** The child every attempt ran, as the pipeline would build it. */
  prompt: string;
  appendSystemPromptFile?: string;
  summary: BenchConfigSummary[];
  attempts: BenchAttemptResult[];
}

/**
 * What a bench child may use. It replaces the Edit / Write grant `addDirs` would
 * add, so a verifier that reads a review directory cannot change it; git is
 * limited to commands that only read.
 */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];
const ATTEMPT_TIMEOUT_MS = 20 * 60 * 1000;

function runAttempt(id: string, prompt: string, options: RunClaudeOptions, ttl: CacheTtl): Promise<Omit<BenchAttemptResult, "label" | "config">> {
  return new Promise((resolve) => {
    const proc = runClaude(id, prompt, options);
    const usage: AttemptUsage = { costUsd: 0, durationMs: 0, outputTokens: 0, numTurns: 0 };
    const timer = setTimeout(() => proc.kill(), ATTEMPT_TIMEOUT_MS);
    proc.onEvent((event) => {
      if (event.type === "output") {
        const u = parseRunUsage(event.data);
        if (u) {
          usage.costUsd += priceRun(u, ttl);
          usage.durationMs += u.durationMs;
          usage.outputTokens += u.outputTokens;
          usage.numTurns += u.numTurns;
        }
      } else if (event.type === "complete") {
        clearTimeout(timer);
        let exitCode = -1;
        try {
          exitCode = JSON.parse(event.data).exitCode;
        } catch {
          // left at -1: a failure
        }
        const text = proc.getResultText() ?? "";
        resolve({ ok: exitCode === 0 && text !== "", text: exitCode === 0 ? text : "", ...usage });
      }
    });
  });
}

export async function runBench(input: BenchInput): Promise<BenchResult | { error: string }> {
  const step = BENCH_STEPS.get(input.step);
  if (!step) return { error: `Unknown step ${input.step}; one of ${[...BENCH_STEPS.keys()].join(", ")}` };
  const built = await step.build(input.workspace, input.repo);
  if ("error" in built) return built;

  const jobs = input.configs.flatMap((config) =>
    Array.from({ length: input.repeats }, (_, i) => ({ config, label: `${config} #${i + 1}` })),
  );
  const results: BenchAttemptResult[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const { config, label } = jobs[index];
      const [model, effort] = config.split("/") as [ClaudeModel, ClaudeEffort];
      const outcome = await runAttempt(`bench-${input.step}-${index}`, built.prompt, {
        jsonSchema: built.jsonSchema,
        addDirs: built.addDirs,
        allowedTools: READ_ONLY_TOOLS,
        appendSystemPromptFile: built.appendSystemPromptFile,
        skipAskUserQuestion: true,
        model,
        effort,
      }, input.ttl ?? "1h");
      results[index] = { label, config, ...outcome };
      input.onAttempt?.(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? 4, jobs.length) }, worker));

  return {
    step: input.step,
    repo: input.repo,
    prompt: built.prompt,
    appendSystemPromptFile: built.appendSystemPromptFile,
    summary: summarizeBench(results),
    attempts: results,
  };
}
