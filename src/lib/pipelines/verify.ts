/**
 * `verify` — one agent checks the workspace's change in the running software
 * and writes `artifacts/verification/<YYYYMMDD-HHMMSS>/report.md`, with any
 * screenshots next to it. It asks the person (AskUserQuestion) for what only
 * they can do, and changes no repository code.
 *
 * A reviewer then reads the report against the README and the request. Gaps a
 * run can close go back to the verifier for one more round; gaps only a person
 * can unblock are reported.
 */

import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import type z from "zod";
import { READ_ONLY_TOOLS, writeGrants } from "@/lib/claude/read-only-tools";
import { getWorkspaceDir } from "@/lib/config";
import { listPrSnapshots } from "@/lib/db/pr-watch";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { verifyReviewSchema } from "@/lib/runtime-schemas";
import { buildVerifierPrompt, buildVerifyReviewerPrompt, VERIFY_REVIEW_SCHEMA } from "@/lib/templates/prompts/verifier";
import { detectBaseBranch, getRepoChanges, listWorkspaceRepos } from "@/lib/workspace";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { getReadme } from "@/lib/workspace/reader";
import { sessionTimestamp } from "@/lib/workspace/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { PhaseFunctionContext, PipelinePhase } from "@/types/pipeline";

/** Rounds of verify → review in all; the last review's gaps are reported, not retried. */
const MAX_ROUNDS = 2;

/** A report directory's name; the step-list scenarios that used to live here are named otherwise. */
const REPORT_DIR_NAME = /^\d{8}-\d{6}$/;

type Gap = z.infer<typeof verifyReviewSchema>["gaps"][number];

interface VerifyInput { workspace: string; instruction?: string }

function verificationDir(wsPath: string): string {
  return path.join(wsPath, "artifacts", "verification");
}

async function latestReport(dir: string): Promise<{ dir: string; text: string } | undefined> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => REPORT_DIR_NAME.test(n)).sort().reverse()) {
    const file = Bun.file(path.join(dir, name, "report.md"));
    if (await file.exists()) return { dir: path.join(dir, name), text: await file.text() };
  }
  return undefined;
}

async function gatherContext(workspace: string) {
  const wsPath = path.join(getWorkspaceDir(), workspace);
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = await listWorkspaceRepos(workspace);
  const prs = listPrSnapshots(workspace);

  const repoInputs = await Promise.all(repos.map(async (repo) => {
    const metaRepo = meta.repositories.find((r) => r.path === repo.repoPath || r.alias === repo.repoName);
    const baseBranch = metaRepo?.baseBranch ?? (await detectBaseBranch(repo.worktreePath));
    const c = await getRepoChanges(workspace, repo.repoPath, baseBranch);
    return {
      repoName: repo.repoName,
      worktreePath: repo.worktreePath,
      baseBranch,
      prUrl: prs.find((p) => p.repoName === repo.repoName)?.prUrl,
      changes: `Branch: ${c.currentBranch}\n\nChanged files:\n${c.changedFiles}\n\nDiff stat:\n${c.diffStat}\n\nCommit log:\n${c.commitLog}`,
    };
  }));
  // The worktrees are listed so their skills and docs are in reach.
  return { wsPath, readmeContent, repoInputs, addDirs: [wsPath, ...repos.map((r) => r.worktreePath)] };
}

function renderGaps(gaps: Gap[]): string {
  return gaps.map((g) => `- **${g.item}**: ${g.problem} Next: ${g.fix}`).join("\n");
}

/** The next round's request: the person's, plus what the review found missing. */
function withGaps(instruction: string | undefined, gaps: Gap[]): string {
  return `${instruction ? `${instruction}\n\n` : ""}A review of the previous run found these gaps. Close each one. Carry over the previous report's results that still stand, so this report is complete on its own:\n\n${renderGaps(gaps)}`;
}

async function runVerifier(ctx: PhaseFunctionContext, workspace: string, instruction: string | undefined): Promise<boolean> {
  const { wsPath, readmeContent, repoInputs, addDirs } = await gatherContext(workspace);
  const reportsDir = verificationDir(wsPath);
  const previousReport = (await latestReport(reportsDir))?.text;
  const reportDir = path.join(reportsDir, sessionTimestamp());
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "report.md");

  const ok = await ctx.runChild(
    "Verifier",
    buildVerifierPrompt({
      workspaceName: workspace,
      workspacePath: wsPath,
      readmeContent,
      repos: repoInputs,
      reportPath,
      instruction,
      previousReport,
    }),
    {
      stepType: STEP_TYPES.VERIFY,
      addDirs,
      allowedTools: [...READ_ONLY_TOOLS, "Bash", ...writeGrants([reportDir])],
      appendSystemPromptFile: await ensureSystemPrompt(wsPath, "verifier"),
    },
  );
  // The report is read in the Verify tab; the verifier's own closing message is the summary.
  if (!(await Bun.file(reportPath).exists())) {
    ctx.emitResult(ok ? "The verifier finished without writing its report." : "The verifier failed.");
    return false;
  }
  return ok;
}

/** The gaps in the latest report, or undefined when the review gave no usable answer. */
async function runReviewer(ctx: PhaseFunctionContext, workspace: string, instruction: string | undefined): Promise<Gap[] | undefined> {
  const { wsPath, readmeContent, repoInputs, addDirs } = await gatherContext(workspace);
  const report = await latestReport(verificationDir(wsPath));
  if (!report) return undefined;

  let resultText = "";
  const ok = await ctx.runChild(
    "Verification reviewer",
    buildVerifyReviewerPrompt({ workspaceName: workspace, readmeContent, repos: repoInputs, instruction, report: report.text, reportDir: report.dir }),
    {
      stepType: STEP_TYPES.VERIFY_REVIEW,
      addDirs,
      allowedTools: READ_ONLY_TOOLS,
      jsonSchema: VERIFY_REVIEW_SCHEMA as unknown as Record<string, unknown>,
      skipAskUserQuestion: true,
      appendSystemPromptFile: await ensureSystemPrompt(wsPath, "verify-reviewer"),
      onResultText: (text) => { resultText = text; },
    },
  );
  if (!ok) return undefined;
  try {
    const parsed = verifyReviewSchema.safeParse(JSON.parse(resultText));
    return parsed.success ? parsed.data.gaps : undefined;
  } catch {
    return undefined;
  }
}

function roundPhases(input: VerifyInput, round: number, gaps: Gap[] = []): PipelinePhase[] {
  const suffix = round > 1 ? ` (round ${round})` : "";
  return [
    {
      kind: "function",
      label: `Verify${suffix}`,
      timeoutMs: 60 * 60 * 1000,
      maxRetries: 0,
      fn: (ctx) => runVerifier(ctx, input.workspace, gaps.length > 0 ? withGaps(input.instruction, gaps) : input.instruction),
    },
    {
      kind: "function",
      label: `Review verification${suffix}`,
      timeoutMs: 20 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const found = await runReviewer(ctx, input.workspace, input.instruction);
        // The report stands on its own; an unreadable review only means no further round.
        if (!found) {
          ctx.emitStatus("The review gave no usable answer; the report stands as written.");
          return true;
        }
        const closable = found.filter((g) => !g.needsPerson);
        if (closable.length > 0 && round < MAX_ROUNDS) {
          ctx.emitStatus(`The review found ${closable.length} gap(s) a run can close; verifying again.`);
          ctx.appendPhases(roundPhases(input, round + 1, closable));
          return true;
        }
        if (found.length > 0) ctx.emitResult(`The review found what the report still does not show:\n\n${renderGaps(found)}`);
        return true;
      },
    },
  ];
}

export function buildVerifyPipeline(input: VerifyInput): PipelinePhase[] {
  return roundPhases(input, 1);
}
