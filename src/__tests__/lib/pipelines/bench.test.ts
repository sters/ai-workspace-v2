// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GroupChild, PhaseFunctionContext, PipelinePhaseFunction } from "@/types/pipeline";

const built: { child: GroupChild | { error: string } } = { child: { label: "x", prompt: "p" } };

vi.mock("@/lib/bench/steps", () => ({
  BENCH_STEPS: new Map([["autonomous-gate", { stepType: "autonomous-gate", label: "Gate", perRepo: false, build: async () => built.child }]]),
}));
vi.mock("@/lib/db/bench-runs", () => ({ insertBenchRun: vi.fn() }));

import { buildBenchPipeline } from "@/lib/pipelines/bench";
import { insertBenchRun } from "@/lib/db/bench-runs";

function ctxReturning(texts: (label: string) => string | null) {
  const seen: GroupChild[] = [];
  const ctx = {
    operationId: "op-1",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    runChildGroup: vi.fn(async (children: GroupChild[]) => {
      seen.push(...children);
      return children.map((c) => {
        const t = texts(c.label);
        if (t !== null) c.onResultText?.(t);
        return t !== null;
      });
    }),
  } as unknown as PhaseFunctionContext;
  return { ctx, seen };
}

const input = {
  workspace: "ws-1",
  step: "autonomous-gate",
  configs: [
    { model: "opus", effort: "medium" },
    { model: "claude-haiku-5-5", effort: "max" },
  ] as const,
  reference: "opus/medium",
  repeats: 2,
};

describe("buildBenchPipeline", () => {
  beforeEach(() => {
    vi.mocked(insertBenchRun).mockReset();
    built.child = { label: "x", prompt: "p", stepType: "autonomous-gate", addDirs: ["/review"] };
  });

  it("runs every configuration the requested number of times, each pinned to its model and effort", async () => {
    const { ctx, seen } = ctxReturning(() => "{}");
    await (buildBenchPipeline({ ...input, configs: [...input.configs] })[0] as PipelinePhaseFunction).fn(ctx);

    expect(seen.map((c) => [c.label, c.model, c.effort])).toEqual([
      ["opus/medium #1", "opus", "medium"],
      ["opus/medium #2", "opus", "medium"],
      ["claude-haiku-5-5/max #1", "claude-haiku-5-5", "max"],
      ["claude-haiku-5-5/max #2", "claude-haiku-5-5", "max"],
    ]);
  });

  it("keeps a child that would get write access to a directory read-only", async () => {
    const { ctx, seen } = ctxReturning(() => "{}");
    await (buildBenchPipeline({ ...input, configs: [...input.configs] })[0] as PipelinePhaseFunction).fn(ctx);
    for (const c of seen) {
      expect(c.allowedTools).toBeDefined();
      expect(c.allowedTools!.some((t) => /^(Edit|Write)/.test(t))).toBe(false);
    }
  });

  it("records each attempt's answer, and a failed one as such", async () => {
    const { ctx } = ctxReturning((label) => (label.startsWith("claude-haiku") && label.endsWith("#2") ? null : `{"from":"${label}"}`));
    await (buildBenchPipeline({ ...input, configs: [...input.configs] })[0] as PipelinePhaseFunction).fn(ctx);

    const saved = vi.mocked(insertBenchRun).mock.calls[0][0];
    expect(saved).toMatchObject({ operationId: "op-1", workspace: "ws-1", step: "autonomous-gate", reference: "opus/medium" });
    expect(saved.attempts.find((a) => a.label === "claude-haiku-5-5/max #2")).toEqual({
      label: "claude-haiku-5-5/max #2", config: "claude-haiku-5-5/max", ok: false, text: "",
    });
    expect(saved.attempts.find((a) => a.label === "opus/medium #1")!.text).toBe('{"from":"opus/medium #1"}');
  });

  it("runs nothing when the step cannot be built for this workspace", async () => {
    built.child = { error: "No review sessions found" };
    const { ctx } = ctxReturning(() => "{}");
    const ok = await (buildBenchPipeline({ ...input, configs: [...input.configs] })[0] as PipelinePhaseFunction).fn(ctx);
    expect(ok).toBe(false);
    expect(ctx.runChildGroup).not.toHaveBeenCalled();
    expect(ctx.emitResult).toHaveBeenCalledWith("No review sessions found");
  });
});
