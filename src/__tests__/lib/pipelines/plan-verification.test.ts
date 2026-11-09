import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import type { PhaseFunctionContext, PipelinePhaseFunction, RunChildOptions } from "@/types/pipeline";

let root: string;

vi.mock("@/lib/config", () => ({ getWorkspaceDir: () => root }));
vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(async () => []),
  detectBaseBranch: vi.fn(async () => "main"),
  getRepoChanges: vi.fn(),
}));
vi.mock("@/lib/workspace/reader", () => ({ getReadme: vi.fn(async () => "# README") }));
vi.mock("@/lib/workspace/prompts", () => ({ ensureSystemPrompt: vi.fn(async () => "/prompts/verification-planner.md") }));

import { buildPlanVerificationPipeline } from "@/lib/pipelines/plan-verification";
import { createScenarios, listScenarios, readScenario, updateScenario } from "@/lib/verification/store";

const WS = "ws1";

function ctxAnswering(answer: unknown) {
  const runChild = vi.fn(async (_label: string, _prompt: string, opts?: RunChildOptions) => {
    opts?.onResultText?.(typeof answer === "string" ? answer : JSON.stringify(answer));
    return true;
  });
  const ctx = {
    operationId: "op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild,
    runChildGroup: vi.fn(),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
  } as unknown as PhaseFunctionContext;
  return { ctx, runChild };
}

async function runPhase(input: Parameters<typeof buildPlanVerificationPipeline>[0], ctx: PhaseFunctionContext) {
  const [phase] = buildPlanVerificationPipeline(input);
  return (phase as PipelinePhaseFunction).fn(ctx);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aiw-planverify-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("plan-verification pipeline", () => {
  it("writes one scenario file per planned scenario", async () => {
    const { ctx } = ctxAnswering({
      scenarios: [
        { title: "Orders list", summary: "s", steps: [{ title: "Start", actor: "claude", command: "make dev", background: true, expected: "up" }] },
        { title: "Admin", summary: "s", steps: [{ title: "Look", actor: "human", instructions: "Open it", expected: "badge" }] },
      ],
    });
    expect(await runPhase({ workspace: WS }, ctx)).toBe(true);
    const all = await listScenarios(path.join(root, WS));
    expect(all.map((s) => s.title).sort()).toEqual(["Admin", "Orders list"]);
    expect(all.every((s) => s.status === "ready" && s.steps.every((st) => st.status === "pending"))).toBe(true);
  });

  it("rejects a plan with a Claude step that has no command, writing nothing", async () => {
    const { ctx } = ctxAnswering({
      scenarios: [{ title: "Bad", summary: "", steps: [{ title: "Start", actor: "claude", expected: "up" }] }],
    });
    expect(await runPhase({ workspace: WS }, ctx)).toBe(false);
    expect(await listScenarios(path.join(root, WS))).toEqual([]);
  });

  it("on replan, keeps the finished steps and replaces the rest at the next revision", async () => {
    const wsPath = path.join(root, WS);
    const [sc] = await createScenarios(wsPath, [{
      title: "Orders",
      summary: "",
      steps: [
        { title: "Seed", actor: "claude", command: "true" },
        { title: "Call", actor: "claude", command: "false" },
        { title: "Down", actor: "claude", command: "true", teardown: true },
      ],
    }]);
    await updateScenario(wsPath, sc.id, (cur) => {
      cur.status = "failed";
      cur.steps[0].status = "passed";
      cur.steps[1].status = "failed";
      cur.steps[1].result = { at: "t", exitCode: 1, note: "500" };
    });

    const { ctx, runChild } = ctxAnswering({
      scenarios: [{ title: "Orders", summary: "", steps: [
        { title: "Call with auth", actor: "claude", command: "true", expected: "200" },
        { title: "Down", actor: "claude", command: "true", teardown: true, expected: "down" },
      ] }],
    });
    expect(await runPhase({ workspace: WS, scenarioId: sc.id, instruction: "use the admin token" }, ctx)).toBe(true);

    const prompt = runChild.mock.calls[0][1];
    expect(prompt).toContain('"note": "500"');
    expect(prompt).toContain("use the admin token");

    const after = (await readScenario(wsPath, sc.id))!;
    expect(after.status).toBe("ready");
    expect(after.revision).toBe(1);
    expect(after.steps.map((s) => [s.title, s.status, s.revision])).toEqual([
      ["Seed", "passed", 0],
      ["Call with auth", "pending", 1],
      ["Down", "pending", 1],
    ]);
  });
});
