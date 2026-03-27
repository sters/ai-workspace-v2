/**
 * Best-of-N pipeline wrapper.
 * Wraps an existing set of pipeline phases to run N candidates in parallel,
 * then selects or synthesizes the best result.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import {
  createSubWorktrees,
  getSubWorktreeDiff,
  getBaseCommit,
  applySubWorktreeResult,
  cleanupSubWorktrees,
} from "./actions/best-of-n-worktree";
import type { SubWorktree } from "./actions/best-of-n-worktree";
import {
  buildBestOfNReviewerPrompt,
  BEST_OF_N_REVIEW_SCHEMA,
} from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { runSubPhases } from "./actions/run-sub-phases";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";
import type { InteractionLevel } from "@/types/prompts";

export interface BestOfNInput {
  workspace: string;
  n: number;
  operationType: string;
  /** Build phases for a single candidate. Receives repos pointing to the sub-worktree paths. */
  buildCandidatePhases: (candidateRepos: WorkspaceRepo[]) => Promise<PipelinePhase[]>;
  repos: WorkspaceRepo[];
  /** When true, ask the user to confirm Best-of-N before starting. */
  confirm?: boolean;
  /** Build normal (non-Best-of-N) phases to run if user declines. Required when confirm is true. */
  buildNormalPhases?: () => Promise<PipelinePhase[]>;
  /** When "high", ask user to confirm/override AI reviewer's decision. */
  interactionLevel?: InteractionLevel;
}

interface CandidateResult {
  index: number;
  label: string;
  success: boolean;
  resultText?: string;
}

/**
 * Build a Best-of-N pipeline: 6 phases that wrap the original operation.
 */
export async function buildBestOfNPipeline(
  input: BestOfNInput,
): Promise<PipelinePhase[]> {
  const { workspace, n, operationType, buildCandidatePhases, repos, confirm, buildNormalPhases, interactionLevel } = input;

  // Shared state across phases (closure-scoped)
  let subWorktrees: SubWorktree[] = [];
  let candidateResults: CandidateResult[] = [];
  let selectedCandidate: number | null = null; // 0-indexed
  let reviewerAction: "select" | "synthesize" = "select";
  let skipReview = false;
  let skipBestOfN = false;

  // Total timeout: N candidates * 25 min + 10 min buffer for review + setup/cleanup
  const candidateTimeoutMs = 25 * 60 * 1000;
  const totalTimeoutMs = candidateTimeoutMs + 15 * 60 * 1000;

  return [
    // Phase 1: Setup sub-worktrees (with optional user confirmation)
    {
      kind: "function",
      label: "Best-of-N: Setup",
      timeoutMs: 60 * 60 * 1000, // 1 hour — may wait for human confirmation
      fn: async (ctx: PhaseFunctionContext) => {
        // Ask user to confirm Best-of-N when enabled via config
        if (confirm) {
          const answers = await ctx.emitAsk([
            {
              question: `Best-of-N mode is enabled (${n} candidates). Use it for this ${operationType}?`,
              options: [
                { label: "Use Best-of-N", description: `Run ${n} candidates in parallel and compare results` },
                { label: "Normal execution", description: "Run single execution without Best-of-N" },
              ],
            },
          ]);
          const answer = Object.values(answers)[0];
          if (answer !== "Use Best-of-N") {
            ctx.emitStatus("Best-of-N skipped — running normal execution");
            skipBestOfN = true;
            if (buildNormalPhases) {
              const normalPhases = await buildNormalPhases();
              return runSubPhases(ctx, normalPhases);
            }
            return true;
          }
        }

        ctx.emitStatus(`Creating ${n} sub-worktrees for Best-of-N execution`);
        try {
          subWorktrees = createSubWorktrees(
            workspace,
            repos,
            n,
            (msg) => ctx.emitStatus(msg),
          );
          ctx.emitStatus(`${n} sub-worktrees created successfully`);
          return true;
        } catch (err) {
          ctx.emitStatus(`Failed to create sub-worktrees: ${err}`);
          return false;
        }
      },
    },

    // Phase 2: Run N candidates in parallel
    {
      kind: "function",
      label: "Best-of-N: Run candidates",
      timeoutMs: totalTimeoutMs,
      fn: async (ctx: PhaseFunctionContext) => {
        if (skipBestOfN) return true;
        ctx.emitStatus(`Running ${n} candidates in parallel`);

        const promises = subWorktrees.map(async (sub) => {
          const result: CandidateResult = {
            index: sub.index,
            label: sub.label,
            success: false,
          };

          try {
            const phases = await buildCandidatePhases(sub.repos);
            ctx.emitStatus(`[${sub.label}] Starting execution`);
            result.success = await runSubPhases(ctx, phases);
            ctx.emitStatus(
              `[${sub.label}] ${result.success ? "Completed successfully" : "Failed"}`,
            );
          } catch (err) {
            ctx.emitStatus(`[${sub.label}] Error: ${err}`);
            result.success = false;
          }

          return result;
        });

        candidateResults = await Promise.all(promises);

        const successCount = candidateResults.filter((r) => r.success).length;
        ctx.emitStatus(
          `Candidates finished: ${successCount}/${n} succeeded`,
        );

        // All failed → abort
        if (successCount === 0) {
          ctx.emitResult(
            "**Best-of-N: All candidates failed.** No results to compare.",
          );
          return false;
        }

        return true;
      },
    },

    // Phase 3: Auto-select when only one succeeds, otherwise proceed to reviewer
    {
      kind: "function",
      label: "Best-of-N: Choose",
      timeoutMs: 5 * 60 * 1000,
      fn: async (ctx: PhaseFunctionContext) => {
        if (skipBestOfN) return true;
        const successful = candidateResults.filter((r) => r.success);

        // If only one succeeded, auto-select
        if (successful.length === 1) {
          selectedCandidate = successful[0].index;
          skipReview = true;
          ctx.emitStatus(
            `Only one candidate succeeded (${successful[0].label}) — auto-selected`,
          );
          ctx.emitResult(
            `**Best-of-N:** Only ${successful[0].label} succeeded — auto-selected.`,
          );
          return true;
        }

        ctx.emitStatus(`${successful.length} candidates succeeded — sending to AI reviewer`);
        return true;
      },
    },

    // Phase 4: Reviewer comparison (conditional — skipped if human directly selected)
    {
      kind: "function",
      label: "Best-of-N: Review",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx: PhaseFunctionContext) => {
        if (skipBestOfN) return true;
        if (skipReview) {
          ctx.emitStatus("Review skipped — candidate already selected");
          return true;
        }

        const readmeContent = (await getReadme(workspace)) ?? "";
        const successful = candidateResults.filter((r) => r.success);

        // Build candidate data for the reviewer
        const candidates = successful.map((result) => {
          const sub = subWorktrees[result.index];
          const diffs: string[] = [];
          for (const repo of repos) {
            const subWtPath = sub.repoPaths.get(repo.repoPath);
            if (!subWtPath) continue;
            const baseCommit = getBaseCommit(repo.worktreePath, subWtPath);
            const diff = getSubWorktreeDiff(subWtPath, baseCommit);
            if (diff) diffs.push(diff);
          }
          return {
            label: result.label,
            diff: diffs.join("\n\n"),
            resultText: result.resultText,
          };
        });

        const prompt = buildBestOfNReviewerPrompt({
          workspaceName: workspace,
          operationType,
          candidates,
          readmeContent,
        });

        // Collect all sub-worktree paths for addDirs
        const addDirs: string[] = [];
        for (const sub of subWorktrees) {
          for (const p of sub.repoPaths.values()) {
            addDirs.push(p);
          }
        }
        // Also add the original worktree paths
        for (const repo of repos) {
          addDirs.push(repo.worktreePath);
        }

        const wsPath = path.join(getWorkspaceDir(), workspace);
        let reviewResultText: string | undefined;

        const ok = await ctx.runChild("Best-of-N Reviewer", prompt, {
          cwd: wsPath,
          addDirs,
          jsonSchema: BEST_OF_N_REVIEW_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.BEST_OF_N_REVIEWER,
          appendSystemPromptFile: ensureSystemPrompt(wsPath, "best-of-n-reviewer"),
          onResultText: (text) => { reviewResultText = text; },
        });

        if (!ok) {
          ctx.emitStatus("Reviewer failed — falling back to first successful candidate");
          selectedCandidate = successful[0].index;
          return true;
        }

        // Parse reviewer decision
        try {
          const decision = JSON.parse(reviewResultText ?? "{}");
          reviewerAction = decision.action ?? "select";
          const candidateNum = decision.candidate ?? 1;
          // Map 1-indexed reviewer choice to 0-indexed into successful array
          const chosenSuccessful = successful[candidateNum - 1];
          selectedCandidate = chosenSuccessful?.index ?? successful[0].index;

          ctx.emitResult(
            `**Best-of-N Reviewer:** ${reviewerAction} — ${decision.reasoning ?? ""}`,
          );
          ctx.emitStatus(
            `Reviewer decided: ${reviewerAction} (candidate-${candidateNum})`,
          );

          if (reviewerAction === "synthesize") {
            ctx.emitStatus(
              "Synthesize action selected — reviewer has made changes in the original worktree",
            );
          }

          // When interactionLevel is "high", let user confirm or override
          if (interactionLevel === "high") {
            const confirmAnswers = await ctx.emitAsk([{
              question: `Reviewer chose to ${reviewerAction} (candidate-${candidateNum}). Accept?`,
              options: [
                { label: "Accept", description: `Accept reviewer's ${reviewerAction} decision` },
                ...successful.map((r) => ({
                  label: `Override: pick ${r.label}`,
                  description: `Use ${r.label} instead`,
                })),
              ],
            }]);
            const confirmAnswer = Object.values(confirmAnswers)[0];
            if (confirmAnswer && confirmAnswer !== "Accept") {
              const match = confirmAnswer.match(/Override: pick candidate-(\d+)/);
              if (match) {
                selectedCandidate = parseInt(match[1], 10) - 1;
                reviewerAction = "select";
                ctx.emitStatus(`Human override: selected candidate-${parseInt(match[1], 10)}`);
              }
            }
          }
        } catch {
          ctx.emitStatus("Failed to parse reviewer result — using first successful candidate");
          selectedCandidate = successful[0].index;
        }

        return true;
      },
    },

    // Phase 5: Apply result to original worktree
    {
      kind: "function",
      label: "Best-of-N: Apply",
      timeoutMs: 5 * 60 * 1000,
      fn: async (ctx: PhaseFunctionContext) => {
        if (skipBestOfN) return true;
        if (reviewerAction === "synthesize") {
          ctx.emitStatus("Synthesized result already applied by reviewer");
          return true;
        }

        if (selectedCandidate == null) {
          ctx.emitStatus("No candidate selected — nothing to apply");
          return false;
        }

        const sub = subWorktrees[selectedCandidate];
        ctx.emitStatus(`Applying ${sub.label} to original worktree`);

        try {
          for (const repo of repos) {
            const subWtPath = sub.repoPaths.get(repo.repoPath);
            if (!subWtPath) continue;
            const baseCommit = getBaseCommit(repo.worktreePath, subWtPath);
            applySubWorktreeResult(repo.worktreePath, subWtPath, baseCommit);
            ctx.emitStatus(`Applied changes from ${sub.label} to ${repo.repoName}`);
          }
          ctx.emitResult(
            `**Best-of-N:** Applied ${sub.label} to workspace.`,
          );
          return true;
        } catch (err) {
          ctx.emitStatus(`Failed to apply result: ${err}`);
          return false;
        }
      },
    },

    // Phase 6: Cleanup sub-worktrees
    {
      kind: "function",
      label: "Best-of-N: Cleanup",
      timeoutMs: 3 * 60 * 1000,
      fn: async (ctx: PhaseFunctionContext) => {
        if (skipBestOfN) return true;
        try {
          cleanupSubWorktrees(
            workspace,
            subWorktrees,
            repos,
            (msg) => ctx.emitStatus(msg),
          );
          return true;
        } catch (err) {
          ctx.emitStatus(`Cleanup warning: ${err}`);
          // Cleanup failure is not fatal
          return true;
        }
      },
    },
  ];
}
