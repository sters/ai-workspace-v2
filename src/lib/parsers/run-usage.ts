import { resultUsageSchema } from "@/lib/runtime-schemas";

export interface RunUsage {
  /** The model that accounts for most of the cost; subagents on other models are folded in. */
  model: string | null;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** Cost of one Claude CLI result event, or undefined for any other stream line. */
export function parseRunUsage(data: string): RunUsage | undefined {
  if (!data.includes('"total_cost_usd"')) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = resultUsageSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const r = parsed.data;

  const byModel = Object.entries(r.model_usage_since_last_result ?? r.modelUsage ?? {});
  const sum = (pick: (u: (typeof byModel)[number][1]) => number) => byModel.reduce((n, [, u]) => n + pick(u), 0);
  const top = byModel.reduce<(typeof byModel)[number] | undefined>((best, e) => (!best || e[1].costUSD > best[1].costUSD ? e : best), undefined);

  return {
    model: top?.[0] ?? null,
    costUsd: r.model_usage_since_last_result ? sum((u) => u.costUSD) : r.total_cost_usd,
    durationMs: r.duration_ms ?? 0,
    numTurns: r.num_turns ?? 0,
    inputTokens: sum((u) => u.inputTokens),
    cacheCreationTokens: sum((u) => u.cacheCreationInputTokens),
    cacheReadTokens: sum((u) => u.cacheReadInputTokens),
    outputTokens: sum((u) => u.outputTokens),
  };
}
