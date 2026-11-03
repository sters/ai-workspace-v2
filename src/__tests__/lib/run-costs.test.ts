import { describe, expect, it } from "vitest";
import { summarizeClaudeRuns } from "@/lib/run-costs";
import type { ClaudeRun } from "@/lib/db/claude-runs";

function run(overrides: Partial<ClaudeRun>): ClaudeRun {
  return {
    id: 0,
    operationId: "op-1",
    operationType: "autonomous",
    workspace: "ws-1",
    phaseLabel: "Cycle 1: Review",
    childLabel: "review-repo",
    stepType: null,
    effort: null,
    model: "claude-opus-5-5",
    costUsd: 1,
    durationMs: 60_000,
    numTurns: 1,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    createdAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeClaudeRuns", () => {
  it("merges the same phase across cycles and sorts each breakdown by cost", () => {
    const summary = summarizeClaudeRuns([
      run({ phaseLabel: "Cycle 1: Review", costUsd: 1 }),
      run({ phaseLabel: "Cycle 2: Review", costUsd: 2 }),
      run({ phaseLabel: "Cycle 1: Execute", costUsd: 4 }),
    ]);

    expect(summary.byPhase.map((g) => [g.key, g.costUsd, g.runs])).toEqual([
      ["autonomous / Cycle N: Execute", 4, 1],
      ["autonomous / Cycle N: Review", 3, 2],
    ]);
  });

  it("drops the child labels a parallel phase is named after", () => {
    const summary = summarizeClaudeRuns([
      run({ operationType: "review", phaseLabel: "Phase 2: review-a, verify-readme-a" }),
      run({ operationType: "review", phaseLabel: "Phase 2: review-b, verify-readme-b" }),
    ]);

    expect(summary.byPhase.map((g) => [g.key, g.runs])).toEqual([["review / Phase 2", 2]]);
  });

  it("groups by step type, falling back to the phase for runs recorded without one", () => {
    const summary = summarizeClaudeRuns([
      run({ stepType: "code-review", costUsd: 1 }),
      run({ stepType: null, phaseLabel: "Cycle 3: Review", costUsd: 1 }),
    ]);

    expect(summary.byStep.map((g) => g.key)).toEqual(["code-review", "(phase) autonomous / Cycle N: Review"]);
  });

  it("ranks operations by their total cost", () => {
    const summary = summarizeClaudeRuns([
      run({ operationId: "a", costUsd: 1 }),
      run({ operationId: "b", costUsd: 2 }),
      run({ operationId: "a", costUsd: 3 }),
    ]);

    expect(summary.totalCostUsd).toBe(6);
    expect(summary.topOperations.map((o) => [o.operationId, o.costUsd])).toEqual([["a", 4], ["b", 2]]);
  });
});
