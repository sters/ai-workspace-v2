import { describe, expect, it } from "vitest";
import { parseRunUsage } from "@/lib/parsers/run-usage";

function usage(cost: number, tokens: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: 10,
    outputTokens: 100,
    cacheReadInputTokens: 1000,
    cacheCreationInputTokens: 500,
    costUSD: cost,
    ...tokens,
  };
}

describe("parseRunUsage", () => {
  it("reads cost, time and tokens from a result event, attributing it to the costliest model", () => {
    const data = JSON.stringify({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.5,
      duration_ms: 20_000,
      num_turns: 5,
      modelUsage: {
        "claude-haiku-5-5": usage(0.1),
        "claude-opus-5-5": usage(0.4, { outputTokens: 300 }),
      },
    });

    expect(parseRunUsage(data)).toEqual({
      model: "claude-opus-5-5",
      costUsd: 0.5,
      durationMs: 20_000,
      numTurns: 5,
      inputTokens: 20,
      cacheCreationTokens: 1000,
      cacheReadTokens: 2000,
      outputTokens: 400,
    });
  });

  it("counts only what a later result of the same process added, since total_cost_usd is cumulative", () => {
    const data = JSON.stringify({
      type: "result",
      total_cost_usd: 1.7,
      result_index: 1,
      duration_ms: 1000,
      num_turns: 2,
      modelUsage: { "claude-opus-5-5": usage(1.7) },
      model_usage_since_last_result: { "claude-opus-5-5": usage(0.5) },
    });

    expect(parseRunUsage(data)?.costUsd).toBe(0.5);
  });

  it("ignores events that are not a costed result", () => {
    expect(parseRunUsage(JSON.stringify({ type: "assistant", message: { content: [] } }))).toBeUndefined();
    expect(parseRunUsage(JSON.stringify({ type: "result", subtype: "success" }))).toBeUndefined();
    expect(parseRunUsage("not json, mentions total_cost_usd")).toBeUndefined();
  });
});
