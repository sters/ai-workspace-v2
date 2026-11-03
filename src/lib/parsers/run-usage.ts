import type z from "zod";
import type { modelUsageSchema } from "@/lib/runtime-schemas";
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

type ModelUsage = z.infer<typeof modelUsageSchema>;

/** Totals over a CLI `modelUsage` map, attributed to its costliest model. */
export function totalModelUsage(byModel: ModelUsage): Omit<RunUsage, "durationMs" | "numTurns"> {
  const entries = Object.entries(byModel);
  const sum = (pick: (u: ModelUsage[string]) => number) => entries.reduce((n, [, u]) => n + pick(u), 0);
  const top = entries.reduce<(typeof entries)[number] | undefined>((best, e) => (!best || e[1].costUSD > best[1].costUSD ? e : best), undefined);
  return {
    model: top?.[0] ?? null,
    costUsd: sum((u) => u.costUSD),
    inputTokens: sum((u) => u.inputTokens),
    cacheCreationTokens: sum((u) => u.cacheCreationInputTokens),
    cacheReadTokens: sum((u) => u.cacheReadInputTokens),
    outputTokens: sum((u) => u.outputTokens),
  };
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

  const totals = totalModelUsage(r.model_usage_since_last_result ?? r.modelUsage ?? {});
  return {
    ...totals,
    costUsd: r.model_usage_since_last_result ? totals.costUsd : r.total_cost_usd,
    durationMs: r.duration_ms ?? 0,
    numTurns: r.num_turns ?? 0,
  };
}
