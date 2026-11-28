import { vi, describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import type { PhaseFunctionContext, PipelinePhase, PipelinePhaseFunction, RunChildOptions } from "@/types/pipeline";

let root: string;

vi.mock("@/lib/config", () => ({ getWorkspaceDir: () => root }));
vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(async () => [
    { repoName: "widgets", repoPath: "github.com/acme/widgets", worktreePath: "/ws/github.com/acme/widgets" },
  ]),
  detectBaseBranch: vi.fn(async () => "main"),
  getRepoChanges: vi.fn(async () => ({ currentBranch: "feature", changedFiles: "src/a.ts", diffStat: "", commitLog: "" })),
}));
vi.mock("@/lib/workspace/reader", () => ({ getReadme: vi.fn(async () => "# README") }));
vi.mock("@/lib/workspace/prompts", () => ({ ensureSystemPrompt: vi.fn(async () => "/prompts/verifier.md") }));
vi.mock("@/lib/db/pr-watch", () => ({
  listPrSnapshots: vi.fn(() => [{ repoName: "widgets", prUrl: "https://github.com/acme/widgets/pull/42" }]),
}));

import { buildVerifyPipeline } from "@/lib/pipelines/verify";

const WS = "ws1";

type Gap = { item: string; problem: string; fix: string; needsPerson: boolean };

/**
 * The verifier writes `report` (when given) into the directory it was granted
 * Write on; the reviewer answers with `gaps`.
 */
function ctxWriting(report: string | null, gaps: Gap[] = []) {
  const appended: PipelinePhase[] = [];
  const runChild = vi.fn(async (_label: string, _prompt: string, opts?: RunChildOptions) => {
    if (opts?.jsonSchema) {
      opts.onResultText?.(JSON.stringify({ gaps }));
      return true;
    }
    const grant = opts?.allowedTools?.find((t) => t.startsWith("Write("));
    if (report !== null && grant) {
      const dir = grant.slice("Write(/".length, -"/**)".length);
      await Bun.write(path.join(dir, "report.md"), report);
    }
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
    appendPhases: vi.fn((p: PipelinePhase[]) => { appended.push(...p); }),
  } as unknown as PhaseFunctionContext;
  return { ctx, runChild, appended };
}

async function runPhase(input: Parameters<typeof buildVerifyPipeline>[0], ctx: PhaseFunctionContext, index = 0) {
  return (buildVerifyPipeline(input)[index] as PipelinePhaseFunction).fn(ctx);
}

const runReview = (input: Parameters<typeof buildVerifyPipeline>[0], ctx: PhaseFunctionContext) => runPhase(input, ctx, 1);

async function writeReport(text: string) {
  await mkdir(path.join(reportsDir(), "20260102-000000"), { recursive: true });
  await Bun.write(path.join(reportsDir(), "20260102-000000", "report.md"), text);
}

const reportsDir = () => path.join(root, WS, "artifacts", "verification");

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aiw-verify-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("verify pipeline", () => {
  it("lets the agent run any command and ask, but write only into its own report directory", async () => {
    const { ctx, runChild } = ctxWriting("# ok");
    expect(await runPhase({ workspace: WS }, ctx)).toBe(true);

    const [dirName] = await readdir(reportsDir());
    expect(dirName).toMatch(/^\d{8}-\d{6}$/);
    const opts = runChild.mock.calls[0][2]!;
    const reportDir = path.join(reportsDir(), dirName);
    expect(opts.allowedTools).toContain("Bash");
    expect(opts.allowedTools?.filter((t) => /^(Write|Edit)\(/.test(t))).toEqual([
      `Edit(/${reportDir}/**)`,
      `Write(/${reportDir}/**)`,
    ]);
    expect(opts.addDirs).toContain("/ws/github.com/acme/widgets");
    expect(opts.skipAskUserQuestion).toBeFalsy();
    expect(runChild.mock.calls[0][1]).toContain(path.join(reportDir, "report.md"));
    // The verifier's closing message already summarises it; the report itself is in the Verify tab.
    expect(ctx.emitResult).not.toHaveBeenCalled();
  });

  it("hands the agent the request, the PRs, and the latest earlier report", async () => {
    await mkdir(path.join(reportsDir(), "20260101-000000"), { recursive: true });
    await Bun.write(path.join(reportsDir(), "20260101-000000", "report.md"), "older report");
    await mkdir(path.join(reportsDir(), "20260102-000000"), { recursive: true });
    await Bun.write(path.join(reportsDir(), "20260102-000000", "report.md"), "latest report");
    // A scenario directory from the step-list verification is not a report.
    await mkdir(path.join(reportsDir(), "zz-orders"), { recursive: true });
    await Bun.write(path.join(reportsDir(), "zz-orders", "report.md"), "not a report");

    const { ctx, runChild } = ctxWriting("# ok");
    expect(await runPhase({ workspace: WS, instruction: "check the orders page on dev" }, ctx)).toBe(true);
    const prompt = runChild.mock.calls[0][1];
    expect(prompt).toContain("check the orders page on dev");
    expect(prompt).toContain("https://github.com/acme/widgets/pull/42");
    expect(prompt).toContain("latest report");
    expect(prompt).not.toContain("older report");
    expect(prompt).not.toContain("not a report");
  });

  it("fails when the agent finishes without writing its report", async () => {
    const { ctx } = ctxWriting(null);
    expect(await runPhase({ workspace: WS }, ctx)).toBe(false);
  });

  it("has the reviewer read the latest report against the README without changing anything", async () => {
    await writeReport("# the report");
    const { ctx, runChild } = ctxWriting(null);
    expect(await runReview({ workspace: WS }, ctx)).toBe(true);

    const [label, prompt, opts] = runChild.mock.calls[0];
    expect(label).toBe("Verification reviewer");
    expect(prompt).toContain("# the report");
    expect(prompt).toContain("# README");
    expect(opts?.allowedTools?.some((t) => /^(Write|Edit)\(|^Bash$/.test(t))).toBe(false);
    expect(opts?.skipAskUserQuestion).toBe(true);
  });

  it("sends the gaps a run can close back to the verifier for one more round", async () => {
    await writeReport("# the report");
    const { ctx, appended } = ctxWriting(null, [
      { item: "Orders page", problem: "Only the empty list was shown", fix: "Seed one order locally and reload", needsPerson: false },
      { item: "SSO login", problem: "Needs the person's sign-in", fix: "Sign in", needsPerson: true },
    ]);
    await runReview({ workspace: WS, instruction: "check the orders page" }, ctx);

    expect(appended.map((p) => (p as PipelinePhaseFunction).label)).toEqual(["Verify (round 2)", "Review verification (round 2)"]);

    const next = ctxWriting("# round 2");
    await (appended[0] as PipelinePhaseFunction).fn(next.ctx);
    const prompt = next.runChild.mock.calls[0][1];
    expect(prompt).toContain("check the orders page");
    expect(prompt).toContain("Seed one order locally and reload");
    expect(prompt).not.toContain("Sign in");
  });

  it("stops when every gap needs a person, or after the last round", async () => {
    await writeReport("# the report");
    const onlyPerson = ctxWriting(null, [{ item: "SSO login", problem: "Needs sign-in", fix: "Sign in", needsPerson: true }]);
    await runReview({ workspace: WS }, onlyPerson.ctx);
    expect(onlyPerson.appended).toEqual([]);

    const gap = { item: "Orders page", problem: "Only the empty list", fix: "Seed one order", needsPerson: false };
    const first = ctxWriting(null, [gap]);
    await runReview({ workspace: WS }, first.ctx);
    const last = ctxWriting(null, [gap]);
    expect(await (first.appended[1] as PipelinePhaseFunction).fn(last.ctx)).toBe(true);
    expect(last.appended).toEqual([]);
    expect(last.ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("Orders page"));
  });
});
