/**
 * An execute bench: one repository's TODO, as planned before execute ran,
 * carried out from the same start commit under several model / effort
 * pairings, each in its own sandbox (`execute-sandbox.ts`). The executor gets
 * the whole TODO in one call, the pipeline's unbatched shape. Each attempt's
 * patch, commits, final TODO and the README's constraint commands are written
 * for a reader to compare; nothing is scored. The start commit's constraint
 * results are written too, so a failure the attempt did not cause shows as one.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace";
import { runGit } from "@/lib/workspace/git-exec";
import { parseConstraints, parseReadmeMeta } from "@/lib/parsers/readme";
import { parseTodoItems } from "@/lib/parsers/todo";
import { resolveRepoBaseBranch } from "@/lib/pipelines/review";
import { buildExecutorPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { readRepoGuidance, repoGuidancePath } from "@/lib/workspace/repo-guidance";
import { buildConstraintReport, execConstraintCommand } from "@/lib/workspace/constraint-runner";
import type { ConstraintExecResult } from "@/lib/workspace/constraint-runner";
import { expandConstraintCommand, resolveConstraintScope, usesScope } from "@/lib/workspace/constraint-scope";
import { collectSandboxOutcome, findPlanStart, prepareSandbox, removeSandbox } from "./execute-sandbox";
import { runAttempt } from "./run";
import { summarizeBench } from "./summary";
import type { BenchConfigSummary } from "./summary";
import type { CacheTtl } from "@/lib/pricing";
import type { RepoConstraint } from "@/lib/parsers/readme";
import type { ClaudeEffort, ClaudeModel } from "@/types/claude";

const EXECUTE_TIMEOUT_MS = 60 * 60 * 1000;
const PLANNED_SNAPSHOT = "^Init complete";

export interface ExecuteBenchInput {
  workspace: string;
  repo: string;
  /** Workspace commit whose README and TODO are the plan; defaults to the last init snapshot. */
  from?: string;
  /** Repository commit to start from; defaults to the one the branch's first commit after the plan was made on. */
  start?: string;
  configs: string[];
  repeats: number;
  concurrency?: number;
  ttl?: CacheTtl;
  outDir: string;
  onAttempt?: (line: string) => void;
}

export interface ExecuteAttemptRecord {
  label: string;
  config: string;
  ok: boolean;
  costUsd: number;
  durationMs: number;
  outputTokens: number;
  numTurns: number;
  commits: string[];
  uncommitted: string[];
  diffStat: string;
  todo: Record<string, number>;
  constraints: { label: string; status: string; exitCode: number | null; durationMs: number }[];
}

export interface ExecuteBenchResult {
  from: string;
  start: string;
  baseline: ExecuteAttemptRecord["constraints"];
  summary: BenchConfigSummary[];
  attempts: ExecuteAttemptRecord[];
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await runGit(args, cwd);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.out}`);
  return r.out;
}

const fileName = (label: string) => label.replace(/[^\w.-]+/g, "_");

async function runConstraints(worktree: string, baseBranch: string, constraints: RepoConstraint[]): Promise<ConstraintExecResult[]> {
  const scope = constraints.some((c) => usesScope(c.command)) ? await resolveConstraintScope(worktree, baseBranch) : null;
  const results: ConstraintExecResult[] = [];
  for (const constraint of constraints) {
    const head = expandConstraintCommand(constraint, scope, "head");
    if (head.kind === "skip") {
      results.push({ label: constraint.label, command: constraint.command, exitCode: null, passed: false, stdout: "", stderr: head.reason, timedOut: false, durationMs: 0, status: "SKIPPED" });
      continue;
    }
    const r = await execConstraintCommand(head.command, { cwd: worktree });
    const status = r.timedOut ? "FAIL" : r.exitCode === 0 ? "PASS" : r.exitCode === 126 || r.exitCode === 127 ? "SKIPPED" : "FAIL";
    results.push({ label: constraint.label, command: constraint.command, ...(head.command !== constraint.command ? { ran: head.command } : {}), ...r, passed: status === "PASS", status });
  }
  return results;
}

const brief = (results: ConstraintExecResult[]) =>
  results.map((r) => ({ label: r.label, status: r.timedOut ? "TIMEOUT" : r.status ?? (r.passed ? "PASS" : "FAIL"), exitCode: r.exitCode, durationMs: r.durationMs }));

export async function runExecuteBench(input: ExecuteBenchInput): Promise<ExecuteBenchResult | { error: string }> {
  const wsPath = path.join(getWorkspaceDir(), input.workspace);
  const repo = (await listWorkspaceRepos(input.workspace)).find((r) => r.repoName === input.repo);
  if (!repo) return { error: `No repository ${input.repo} in ${input.workspace}` };

  const from = input.from ?? (await git(wsPath, "log", "-n1", "--format=%H", `--grep=${PLANNED_SNAPSHOT}`));
  if (!from) return { error: "No init snapshot in the workspace history; pass --from <workspace commit>" };
  const todoName = `TODO-${repo.repoName}.md`;
  const readmeContent = await git(wsPath, "show", `${from}:README.md`);
  const todoContent = await git(wsPath, "show", `${from}:${todoName}`).catch(() => "");
  if (!parseTodoItems(todoContent).some((i) => i.status !== "completed")) return { error: `${todoName} at ${from.slice(0, 8)} has nothing to do` };

  const baseBranch = await resolveRepoBaseBranch(parseReadmeMeta(readmeContent), repo);
  const plannedAt = await git(wsPath, "log", "-n1", "--format=%cI", from);
  const start = input.start ?? (await findPlanStart(repo.worktreePath, plannedAt));
  if (!start) return { error: `${repo.repoName} has no commit after ${from.slice(0, 8)}; pass --start <repository commit>` };
  const constraints = parseConstraints(readmeContent).find((c) => c.repoName === repo.repoName)?.constraints ?? [];
  const guidancePath = repoGuidancePath(wsPath, repo.repoName);
  const guidanceFile = Bun.file(guidancePath);
  const files: Record<string, string> = { "README.md": readmeContent, [todoName]: todoContent };
  if (await guidanceFile.exists()) files[path.relative(wsPath, guidancePath)] = await guidanceFile.text();

  const sandboxRoot = path.join(input.outDir, "sandboxes");
  const answersDir = path.join(input.outDir, "answers");

  const withSandbox = async <T>(name: string, fn: (sandboxWs: string, worktree: string) => Promise<T>): Promise<T> => {
    const sandboxWs = path.join(sandboxRoot, name);
    const branch = `aiw-bench/${path.basename(input.outDir)}/${name}`;
    const worktree = await prepareSandbox({ sourceWorktree: repo.worktreePath, startSha: start, branch, sandboxWsPath: sandboxWs, repoPath: repo.repoPath, files });
    try {
      return await fn(sandboxWs, worktree);
    } finally {
      await removeSandbox(repo.worktreePath, worktree, branch);
    }
  };

  input.onAttempt?.(`baseline: running ${constraints.length} constraint command(s) at ${start.slice(0, 10)}`);
  const baselineResults = await withSandbox("baseline", (_ws, wt) => runConstraints(wt, baseBranch, constraints));
  await Bun.write(path.join(input.outDir, "baseline.constraints.md"), buildConstraintReport(repo.repoName, baselineResults));

  const jobs = input.configs.flatMap((config) => Array.from({ length: input.repeats }, (_, i) => ({ config, label: `${config} #${i + 1}` })));
  const records: ExecuteAttemptRecord[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const { config, label } = jobs[index];
      const [model, effort] = config.split("/") as [ClaudeModel, ClaudeEffort];
      records[index] = await withSandbox(fileName(label), async (sandboxWs, worktree) => {
        const prompt = buildExecutorPrompt({
          workspaceName: input.workspace,
          repoPath: repo.repoPath,
          repoName: repo.repoName,
          readmeContent,
          todoContent,
          worktreePath: worktree,
          workspacePath: sandboxWs,
          repoGuidance: (await readRepoGuidance(sandboxWs, repo.repoName))?.implementation,
        });
        if (index === 0) await Bun.write(path.join(input.outDir, "prompt.md"), prompt);
        const run = await runAttempt(`bench-execute-${index}`, prompt, {
          addDirs: [sandboxWs],
          appendSystemPromptFile: await ensureSystemPrompt(sandboxWs, "executor"),
          skipAskUserQuestion: true,
          model,
          effort,
        }, input.ttl ?? "1h", EXECUTE_TIMEOUT_MS);
        const outcome = await collectSandboxOutcome(worktree, start);
        const todoAfter = await Bun.file(path.join(sandboxWs, todoName)).text().catch(() => "");
        const constraintResults = await runConstraints(worktree, baseBranch, constraints);

        const stem = path.join(answersDir, fileName(label));
        await Bun.write(`${stem}.patch`, outcome.patch);
        await Bun.write(`${stem}.todo.md`, todoAfter);
        await Bun.write(`${stem}.constraints.md`, buildConstraintReport(repo.repoName, constraintResults));
        await Bun.write(`${stem}.result.md`, run.text);
        const todo: Record<string, number> = {};
        for (const item of parseTodoItems(todoAfter)) todo[item.status] = (todo[item.status] ?? 0) + 1;
        const record: ExecuteAttemptRecord = {
          label, config, ok: run.ok, costUsd: run.costUsd, durationMs: run.durationMs, outputTokens: run.outputTokens, numTurns: run.numTurns,
          commits: outcome.commits, uncommitted: outcome.uncommitted, diffStat: outcome.diffStat, todo, constraints: brief(constraintResults),
        };
        await Bun.write(`${stem}.json`, JSON.stringify(record, null, 2));
        const passed = constraintResults.filter((r) => r.passed).length;
        input.onAttempt?.(`  ${label.padEnd(30)} ${run.ok ? "ok    " : "FAILED"} $${run.costUsd.toFixed(3)}  ${Math.round(run.durationMs / 1000)}s  ${outcome.commits.length} commit(s)  constraints ${passed}/${constraintResults.length}`);
        return record;
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? 2, jobs.length) }, worker));

  return {
    from,
    start,
    baseline: brief(baselineResults),
    summary: summarizeBench(records.map((r) => ({ ...r, text: "" }))),
    attempts: records,
  };
}
