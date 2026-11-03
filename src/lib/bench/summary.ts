import { agreement, verdictsFor } from "./compare";

export interface BenchAttempt {
  /** The child label, unique within the run: `<config> #<n>`. */
  label: string;
  /** `<model>/<effort>`. */
  config: string;
  ok: boolean;
  /** The structured output as the child returned it; "" when it returned none. */
  text: string;
}

export interface BenchConfigSummary {
  config: string;
  attempts: number;
  succeeded: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  /**
   * Share of the reference's verdicts each attempt reached, averaged over the
   * attempts that answered, other than the reference's first; a failed attempt
   * shows in `succeeded`, not here. Null when there is nothing to compare.
   */
  agreement: number | null;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export function summarizeBench(
  step: string,
  reference: string,
  attempts: BenchAttempt[],
  costs: ReadonlyMap<string, { costUsd: number; durationMs: number }>,
): BenchConfigSummary[] {
  const refAttempt = attempts.find((a) => a.config === reference && a.ok && parse(a.text) !== undefined);
  const refVerdicts = refAttempt ? verdictsFor(step, parse(refAttempt.text)) : [];

  const configs = [...new Set(attempts.map((a) => a.config))];
  return configs.map((config) => {
    const mine = attempts.filter((a) => a.config === config);
    const priced = mine.map((a) => costs.get(a.label)).filter((c) => c !== undefined);
    const scores = refAttempt && refVerdicts.length > 0
      ? mine
          .filter((a) => a !== refAttempt)
          .map((a) => (a.ok ? parse(a.text) : undefined))
          .filter((output) => output !== undefined)
          .map((output) => {
            const r = agreement(refVerdicts, verdictsFor(step, output));
            return r.same / r.total;
          })
      : [];
    return {
      config,
      attempts: mine.length,
      succeeded: mine.filter((a) => a.ok).length,
      avgCostUsd: mean(priced.map((c) => c.costUsd)),
      avgDurationMs: mean(priced.map((c) => c.durationMs)),
      agreement: mean(scores),
    };
  });
}
