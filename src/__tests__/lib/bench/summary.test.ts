import { describe, expect, it } from "vitest";
import { summarizeBench } from "@/lib/bench/summary";

const attempt = (config: string, n: number, ok: boolean, costUsd: number, outputTokens: number) => ({
  label: `${config} #${n}`, config, ok, text: ok ? "{}" : "", costUsd, durationMs: costUsd * 1000, outputTokens, numTurns: n,
});

describe("summarizeBench", () => {
  it("averages each pairing over all its attempts, keeping the order pairings were given in", () => {
    const rows = summarizeBench([
      attempt("opus/medium", 1, true, 1, 100),
      attempt("opus/medium", 2, true, 3, 300),
      attempt("claude-haiku-5-5/xhigh", 1, true, 0.2, 9000),
      attempt("claude-haiku-5-5/xhigh", 2, false, 0, 0),
    ]);
    expect(rows.map((r) => r.config)).toEqual(["opus/medium", "claude-haiku-5-5/xhigh"]);
    expect(rows[0]).toMatchObject({ attempts: 2, succeeded: 2, avgCostUsd: 2, avgOutputTokens: 200, avgTurns: 1.5 });
    expect(rows[1]).toMatchObject({ attempts: 2, succeeded: 1, avgCostUsd: 0.1 });
  });
});
