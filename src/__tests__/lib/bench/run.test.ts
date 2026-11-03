// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClaudeProcess, RunClaudeOptions } from "@/types/claude";
import type { GroupChild } from "@/types/pipeline";
import type { OperationEvent } from "@/types/operation";

const built: { child: GroupChild | { error: string } } = { child: { label: "x", prompt: "p" } };

vi.mock("@/lib/bench/steps", () => ({
  BENCH_STEPS: new Map([["autonomous-gate", { stepType: "autonomous-gate", label: "Gate", perRepo: false, build: async () => built.child }]]),
}));
vi.mock("@/lib/claude", () => ({ runClaude: vi.fn() }));

import { runBench } from "@/lib/bench/run";
import { runClaude } from "@/lib/claude";

/** A child that answers `answer(options)` (or fails on null) after reporting one costed result. */
function fakeClaude(answer: (opts: RunClaudeOptions) => string | null) {
  vi.mocked(runClaude).mockImplementation((_id, _prompt, opts) => {
    const text = answer(opts!);
    return {
      onEvent: (handler: (e: OperationEvent) => void) => {
        setTimeout(() => {
          const timestamp = new Date().toISOString();
          handler({
            type: "output",
            operationId: "x",
            timestamp,
            data: JSON.stringify({
              type: "result",
              total_cost_usd: 1,
              duration_ms: 2000,
              num_turns: 3,
              modelUsage: { "claude-opus-5-5": { inputTokens: 0, outputTokens: 1_000_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 } },
            }),
          });
          handler({ type: "complete", operationId: "x", timestamp, data: JSON.stringify({ exitCode: text === null ? 1 : 0 }) });
        }, 0);
      },
      getResultText: () => text ?? undefined,
      kill: () => {},
    } as unknown as ClaudeProcess;
  });
}

const input = {
  workspace: "ws-1",
  step: "autonomous-gate",
  configs: ["opus/medium", "claude-haiku-5-5/xhigh"],
  repeats: 2,
};

describe("runBench", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockReset();
    built.child = { label: "x", prompt: "p", stepType: "autonomous-gate", addDirs: ["/review"] };
  });

  it("runs every pairing the requested number of times, each pinned to its model and effort and read-only", async () => {
    fakeClaude(() => "{}");
    await runBench(input);

    const calls = vi.mocked(runClaude).mock.calls.map(([, , o]) => o!);
    expect(calls.map((o) => `${o.model}/${o.effort}`)).toEqual([
      "opus/medium", "opus/medium", "claude-haiku-5-5/xhigh", "claude-haiku-5-5/xhigh",
    ]);
    for (const o of calls) {
      expect(o.allowedTools!.some((t) => /^(Edit|Write)/.test(t))).toBe(false);
      expect(o.addDirs).toEqual(["/review"]);
    }
  });

  it("prices each attempt at list rates and reports its answer, a failed one as such", async () => {
    fakeClaude((o) => (o.model === "claude-haiku-5-5" ? null : '{"shouldLoop":true}'));
    const result = await runBench(input);
    if ("error" in result) throw new Error(result.error);

    const opus = result.attempts.find((a) => a.label === "opus/medium #1")!;
    // 1M output tokens at Opus 5.5's $20/MTok, whatever the CLI reported.
    expect(opus).toMatchObject({ ok: true, text: '{"shouldLoop":true}', costUsd: 20, outputTokens: 1_000_000, numTurns: 3 });
    expect(result.attempts.find((a) => a.label === "claude-haiku-5-5/xhigh #2")).toMatchObject({ ok: false, text: "" });
    expect(result.summary.find((s) => s.config === "claude-haiku-5-5/xhigh")).toMatchObject({ succeeded: 0, attempts: 2 });
  });

  it("runs nothing when the step cannot be built for this workspace", async () => {
    built.child = { error: "No review sessions found" };
    expect(await runBench(input)).toEqual({ error: "No review sessions found" });
    expect(runClaude).not.toHaveBeenCalled();
  });
});
