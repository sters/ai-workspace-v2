export interface BenchAttempt {
  /** Unique within the run: `<model>/<effort> #<n>`. */
  label: string;
  /** `<model>/<effort>`. */
  config: string;
  ok: boolean;
  /** The structured output as the child returned it; "" when it returned none. */
  text: string;
}

export interface AttemptUsage {
  costUsd: number;
  durationMs: number;
  outputTokens: number;
  numTurns: number;
}

export interface BenchConfigSummary {
  config: string;
  attempts: number;
  succeeded: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  /** Thinking included: the number that tells a terse pairing from one that thinks at length. */
  avgOutputTokens: number | null;
  avgTurns: number | null;
}

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Per pairing, in the order the pairings were given. */
export function summarizeBench(attempts: (BenchAttempt & AttemptUsage)[]): BenchConfigSummary[] {
  return [...new Set(attempts.map((a) => a.config))].map((config) => {
    const mine = attempts.filter((a) => a.config === config);
    return {
      config,
      attempts: mine.length,
      succeeded: mine.filter((a) => a.ok).length,
      avgCostUsd: mean(mine.map((a) => a.costUsd)),
      avgDurationMs: mean(mine.map((a) => a.durationMs)),
      avgOutputTokens: mean(mine.map((a) => a.outputTokens)),
      avgTurns: mean(mine.map((a) => a.numTurns)),
    };
  });
}
