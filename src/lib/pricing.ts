/**
 * Anthropic list prices, used to cost a run from its tokens instead of trusting
 * the CLI's `total_cost_usd`, which prices some models at another model's rates.
 * Update the table when the published prices change.
 *
 * Cache writes cost 2x input on a 1-hour TTL and 1.25x on a 5-minute one; which
 * applies depends on how the account is billed, so the caller chooses.
 */

/** USD per million tokens. */
interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
}

// `cacheRead` is published for Opus 5.5, Sonnet 5.5 and Fable 5.1; elsewhere it
// is taken as 0.1x input, the usual ratio.
const RATES: Record<string, ModelRates> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Haiku 5.5 steps up to $0.50 / $2.50 past 100K prompt tokens per request,
  // which per-run totals cannot see; its runs are priced at the base tier.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export type CacheTtl = "1h" | "5m";

const WRITE_MULTIPLIER: Record<CacheTtl, number> = { "1h": 2, "5m": 1.25 };

export interface PricedTokens {
  model: string | null;
  /** What the CLI reported; kept for a model this table has no rates for. */
  costUsd: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** `claude-opus-5-5[1m]` and dated IDs like `claude-haiku-4-5-20251001` share their base model's rates. */
function ratesFor(model: string): ModelRates | undefined {
  const base = model.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  return RATES[base];
}

export function priceRun(run: PricedTokens, ttl: CacheTtl): number {
  const rates = run.model ? ratesFor(run.model) : undefined;
  if (!rates) return run.costUsd;
  return (
    (run.inputTokens * rates.input +
      run.cacheCreationTokens * rates.input * WRITE_MULTIPLIER[ttl] +
      run.cacheReadTokens * rates.cacheRead +
      run.outputTokens * rates.output) /
    1_000_000
  );
}
