/**
 * "New Workspace from PR" pipeline.
 *
 * Given a GitHub PR URL, this pipeline:
 *   1. Verifies the PR and identifies its repository (via `gh`).
 *   2. Reads the PR title/body and lets Claude draft a README + workspace name.
 *   3. Creates the workspace and a git worktree with the PR's head branch
 *      checked out (cloning the repository first if needed).
 *
 * It stops there. Optionally, the same TODO-planning phases used by `init` and
 * a review pass can be appended via `withTodo` / `withReview` — these are the
 * "TODO / review" follow-ups the user can opt into up front.
 *
 * Fork PRs (head from a different owner) are intentionally not supported yet:
 * `origin/<headBranch>` does not exist for them, so the Verify phase fails fast.
 */

import path from "node:path";
import {
  parseAnalysisResultText,
  setupWorkspace,
  commitWorkspaceSnapshot,
  writeTodoTemplate,
  writeReportTemplates,
} from "@/lib/workspace";
import { exec } from "@/lib/workspace/helpers";
import { ensureGlobalSystemPrompt } from "@/lib/workspace/prompts";
import { extractPrUrls, resolvePrBranch } from "@/lib/workspace/pr-url";
import type { PrBranchInfo } from "@/lib/workspace/pr-url";
import { setupRepository } from "./actions/setup-repository";
import { buildInitTodoAnalysisPhases } from "./actions/init-todo-analysis";
import { runSubPhases } from "./actions/run-sub-phases";
import { buildReviewPipeline } from "./review";
import {
  buildReadmeContent,
  buildInitAnalyzeAndReadmePrompt,
  INIT_ANALYSIS_SCHEMA,
} from "@/lib/templates";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, SetupRepositoryResult } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";
import type { TaskAnalysis } from "@/types/workspace";

export interface InitFromPrOptions {
  interactionLevel?: InteractionLevel;
  /**
   * Free-text instruction for TODO planning. When non-empty, init's
   * TODO-planning phases are appended after the worktree is created, and the
   * instruction is passed to the planner so the AI decides what TODOs to make.
   */
  todoInstruction?: string;
  /** Append a review pass after the worktree is created. */
  withReview?: boolean;
}

interface PrMeta {
  title: string;
  body: string;
  number: number;
}

/** Build a description for the README analyzer from the resolved PR info. */
function buildPrDescription(prInfo: PrBranchInfo, prMeta: PrMeta | null): string {
  const lines = [`GitHub Pull Request: ${prInfo.prUrl}`];
  if (prMeta?.title) lines.push(`\nPR Title: ${prMeta.title}`);
  if (prMeta?.body) lines.push(`\nPR Description:\n${prMeta.body}`);
  lines.push(
    `\nThis workspace is being created to work with the existing PR above. ` +
      `Its branch \`${prInfo.headBranch}\` (targeting \`${prInfo.baseBranch}\`) will be checked out as a worktree.`,
  );
  return lines.join("\n");
}

export function buildInitFromPrPipeline(
  prUrlInput: string,
  options: InitFromPrOptions = {},
): PipelinePhase[] {
  const { interactionLevel, todoInstruction, withReview } = options;
  const wantTodo = !!todoInstruction?.trim();

  // Shared mutable state across phases.
  let wsName = "";
  let wsPath = "";
  let prInfo: PrBranchInfo | null = null;
  let prMeta: PrMeta | null = null;
  let analysis: (TaskAnalysis & { readmeContent?: string }) | null = null;
  let description = prUrlInput;
  const repoResults: SetupRepositoryResult[] = [];

  const phases: PipelinePhase[] = [
    // Phase 1: Verify the PR and identify its repository / branches.
    {
      kind: "function",
      label: "Verify PR",
      maxRetries: 0,
      fn: async (ctx) => {
        const prUrls = extractPrUrls(prUrlInput);
        if (prUrls.length === 0) {
          ctx.emitResult(`No valid GitHub PR URL found in input: ${prUrlInput}`);
          return false;
        }
        const target = prUrls[0];
        ctx.emitStatus(`Identified PR: ${target.url} (repository: ${target.repoPath})`);

        try {
          prInfo = resolvePrBranch(target);
        } catch (err) {
          ctx.emitResult(`Failed to resolve PR branch info via gh: ${err}`);
          return false;
        }

        if (prInfo.isFork) {
          ctx.emitResult(
            `PR #${target.prNumber} originates from a fork (head: ${prInfo.headBranch}). ` +
              `Fork PRs are not supported yet.`,
          );
          return false;
        }

        ctx.emitStatus(`Branch: ${prInfo.headBranch} → ${prInfo.baseBranch}`);

        // Fetch PR title/body so the workspace can be named from the PR content.
        try {
          const out = exec(`gh pr view "${target.url}" --json title,body,number`);
          const data = JSON.parse(out) as { title?: string; body?: string; number?: number };
          prMeta = {
            title: data.title ?? "",
            body: data.body ?? "",
            number: data.number ?? target.prNumber,
          };
          if (prMeta.title) ctx.emitStatus(`PR title: ${prMeta.title}`);
        } catch (err) {
          ctx.emitStatus(`Warning: failed to fetch PR details (${err}); naming from URL only`);
          prMeta = { title: "", body: "", number: target.prNumber };
        }

        ctx.emitResult(
          `PR verified: **${target.repoPath}#${target.prNumber}** — ` +
            `\`${prInfo.headBranch}\` → \`${prInfo.baseBranch}\``,
        );
        return true;
      },
    },
    // Phase 2: Read the PR and let Claude determine naming + draft a README.
    {
      kind: "function",
      label: "Analyze PR & draft README",
      timeoutMs: 60 * 60 * 1000, // 1 hour — may wait for human confirmation
      fn: async (ctx) => {
        if (!prInfo) return false;

        const today = new Date().toISOString().slice(0, 10);
        description = buildPrDescription(prInfo, prMeta);
        const readmeTemplate = buildReadmeContent(description, "TBD", "TBD", today);
        const prompt = buildInitAnalyzeAndReadmePrompt({
          description,
          readmeTemplate,
          interactionLevel,
        });

        const ok = await ctx.runChild("Analyze PR & draft README", prompt, {
          jsonSchema: INIT_ANALYSIS_SCHEMA,
          stepType: STEP_TYPES.ANALYZE_README,
          appendSystemPromptFile: ensureGlobalSystemPrompt("init-readme"),
          onResultText: (text) => {
            const base = parseAnalysisResultText(text, description);
            let readmeContent: string | undefined;
            try {
              const { values } = Bun.JSONL.parseChunk(text);
              const parsed = values[0] as Record<string, unknown> | undefined;
              if (parsed && typeof parsed.readmeContent === "string") {
                readmeContent = parsed.readmeContent;
              }
            } catch { /* fall back to template */ }
            analysis = { ...base, readmeContent };
          },
        });

        if (!ok) return false;
        if (!analysis) analysis = parseAnalysisResultText(undefined, description);
        // The repository is authoritative from the PR — don't rely on the model.
        analysis.repositories = [prInfo.repoPath];
        return true;
      },
    },
    // Phase 3: Create the workspace and check out the PR branch as a worktree.
    // No retries: setupWorkspace is not idempotent (retrying creates duplicates).
    {
      kind: "function",
      label: "Setup workspace",
      maxRetries: 0,
      fn: async (ctx) => {
        if (!prInfo) return false;
        if (!analysis) analysis = parseAnalysisResultText(undefined, description);

        ctx.emitStatus(
          `Detected: type=${analysis.taskType}, slug=${analysis.slug}` +
            (analysis.ticketId ? `, ticket=${analysis.ticketId}` : ""),
        );

        ctx.emitStatus("Creating workspace directory...");
        const result = await setupWorkspace(
          analysis.taskType,
          description,
          analysis.ticketId || undefined,
          analysis.slug,
        );
        wsName = result.workspaceName;
        wsPath = result.workspacePath;
        ctx.setWorkspace(wsName);
        ctx.emitStatus(`Workspace created: ${wsName}`);

        if (analysis.readmeContent) {
          await Bun.write(path.join(wsPath, "README.md"), analysis.readmeContent);
        }

        if (analysis.taskType !== "review" && analysis.taskType !== "research") {
          await writeTodoTemplate(wsPath, analysis.taskType);
        }
        await writeReportTemplates(wsPath);

        if (ctx.signal.aborted) return false;

        ctx.emitStatus(
          `Setting up repository ${prInfo.repoPath} (checking out PR branch ${prInfo.headBranch})`,
        );
        try {
          // checkoutBranch === PR head branch — we want the PR's branch, not a new one.
          const repoResult = setupRepository(
            wsName,
            prInfo.repoPath,
            prInfo.baseBranch,
            ctx.emitStatus,
            prInfo.headBranch,
          );
          repoResults.push(repoResult);
        } catch (err) {
          ctx.emitResult(`Failed to setup repository ${prInfo.repoPath}: ${err}`);
          return false;
        }

        await commitWorkspaceSnapshot(
          wsName,
          "Init from PR: workspace created with PR branch checked out",
        );

        const repo = repoResults[0];
        ctx.emitResult(
          `Workspace **${wsName}** created. ` +
            `Checked out PR branch \`${repo?.branchName}\` in \`${repo?.repoName}\`.`,
        );
        return true;
      },
    },
  ];

  if (wantTodo) {
    phases.push(
      ...buildInitTodoAnalysisPhases({
        wsName: () => wsName,
        wsPath: () => wsPath,
        repos: () =>
          repoResults.map((r) => ({
            repoPath: r.repoPath,
            repoName: r.repoName,
            worktreePath: r.worktreePath,
          })),
        taskType: () => analysis?.taskType ?? "",
        interactionLevel,
        instruction: () => todoInstruction,
        commitMessage: "Init from PR: TODO planning complete",
      }),
    );
  }

  if (withReview) {
    phases.push({
      kind: "function",
      label: "Review",
      timeoutMs: 60 * 60 * 1000,
      fn: async (ctx) => {
        if (!wsName) {
          ctx.emitResult("Review skipped — workspace was not created.");
          return false;
        }
        // buildReviewPipeline reads the workspace from disk, so it must be built
        // at runtime (after Setup workspace) rather than up front.
        const reviewPhases = await buildReviewPipeline({ workspace: wsName });
        return runSubPhases(ctx, reviewPhases);
      },
    });
  }

  return phases;
}
