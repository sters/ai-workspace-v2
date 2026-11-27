/**
 * `verify` — one agent checks the workspace's change in the running software
 * and writes `artifacts/verification/<YYYYMMDD-HHMMSS>/report.md`, with any
 * screenshots next to it. It asks the person (AskUserQuestion) for what only
 * they can do, and changes no repository code.
 */

import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { READ_ONLY_TOOLS, writeGrants } from "@/lib/claude/read-only-tools";
import { getWorkspaceDir } from "@/lib/config";
import { listPrSnapshots } from "@/lib/db/pr-watch";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { buildVerifierPrompt } from "@/lib/templates/prompts/verifier";
import { detectBaseBranch, getRepoChanges, listWorkspaceRepos } from "@/lib/workspace";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { getReadme } from "@/lib/workspace/reader";
import { sessionTimestamp } from "@/lib/workspace/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";

/** A report directory's name; the step-list scenarios that used to live here are named otherwise. */
const REPORT_DIR_NAME = /^\d{8}-\d{6}$/;

function verificationDir(wsPath: string): string {
  return path.join(wsPath, "artifacts", "verification");
}

async function latestReport(dir: string): Promise<string | undefined> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => REPORT_DIR_NAME.test(n)).sort().reverse()) {
    const file = Bun.file(path.join(dir, name, "report.md"));
    if (await file.exists()) return file.text();
  }
  return undefined;
}

export function buildVerifyPipeline(input: { workspace: string; instruction?: string }): PipelinePhase[] {
  const { workspace, instruction } = input;
  return [{
    kind: "function",
    label: "Verify",
    timeoutMs: 60 * 60 * 1000,
    maxRetries: 0,
    fn: async (ctx) => {
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

      const reportsDir = verificationDir(wsPath);
      const previousReport = await latestReport(reportsDir);
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
          // The worktrees are listed so their skills load; writes stay in the report directory.
          addDirs: [wsPath, ...repos.map((r) => r.worktreePath)],
          allowedTools: [...READ_ONLY_TOOLS, "Bash", ...writeGrants([reportDir])],
          appendSystemPromptFile: await ensureSystemPrompt(wsPath, "verifier"),
        },
      );
      const report = Bun.file(reportPath);
      if (!(await report.exists())) {
        ctx.emitResult(ok ? "The verifier finished without writing its report." : "The verifier failed.");
        return false;
      }
      ctx.emitResult(await report.text());
      return ok;
    },
  }];
}
