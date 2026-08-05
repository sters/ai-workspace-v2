/**
 * `validate-pr-comments` — the operation behind the Pull Requests tab's
 * **validate** button.
 *
 * One Claude child per selected review thread, all in a single group phase, each
 * answering one question: what is this comment asking for, and does it hold
 * against the code? Verdicts land in the workspace's validation store, which the
 * tab reads back, so the result is durable and can be fed into a later triage
 * (the validate → triage route).
 *
 * One child per thread rather than one per PR is a deliberate cost trade. A
 * single call covering ten comments shares the worktree context and is cheaper,
 * but it treats the tenth comment as an afterthought, and each verdict here is
 * read by a human deciding whether to spend a whole autonomous run on it. The
 * threads are independent, so per-thread children also run concurrently — bounded
 * by `getMaxGroupConcurrency()`, like every other group — which keeps the wall
 * clock near that of a single comment.
 *
 * The children never write anything: the phase collects their structured output
 * and does the one write itself, which is also what makes a single store file
 * race-free.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import {
  buildPrCommentValidatorPrompt,
  PR_COMMENT_VALIDATION_SCHEMA,
} from "@/lib/templates/prompts/pr-comment-validator";
import { listWorkspacePullRequests } from "@/lib/workspace/pr-threads";
import { normalizeVerdict, writePrValidations } from "@/lib/workspace/pr-validations";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhase } from "@/types/pipeline";
import type { PrReviewThread, PrThreadValidation } from "@/types/pull-request";

export const VALIDATE_PR_COMMENTS_PHASE_LABEL = "Validate PR comments";

/**
 * Budget for the whole phase.
 *
 * Per selected thread rather than flat, for the same reason
 * `executePhaseBudgetMs` is per item of batch capacity: children run
 * concurrently, but the concurrency cap means a large selection queues, and a
 * budget sized for one comment would kill the tail of a ten-comment selection
 * and re-run all of it on the same budget.
 */
export function validatePrCommentsBudgetMs(threadCount: number): number {
  const PER_THREAD_MS = 4 * 60 * 1000;
  const BASE_MS = 5 * 60 * 1000;
  return BASE_MS + Math.max(1, threadCount) * PER_THREAD_MS;
}

/**
 * Turn one child's structured output into a stored validation.
 *
 * Returns null when the output is unreadable: a thread with no verdict is better
 * left un-validated than recorded as `unclear`, which the tab would render as a
 * considered answer meaning "the code cannot settle this".
 */
export function parseValidationResult(
  raw: string,
  context: { thread: PrReviewThread; repoName: string; validatedAt: string },
): PrThreadValidation | null {
  if (!raw.trim()) return null;

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const verdict = str(json.verdict);
  if (!verdict) return null;

  return {
    threadId: context.thread.id,
    repoName: context.repoName,
    commentUrl: context.thread.comments[0]?.url ?? "",
    verdict: normalizeVerdict(verdict),
    interpretation: str(json.interpretation),
    reasoning: str(json.reasoning),
    recommendation: str(json.recommendation),
    evidence: Array.isArray(json.evidence)
      ? json.evidence.filter((e): e is string => typeof e === "string")
      : [],
    validatedAt: context.validatedAt,
  };
}

export function buildValidatePrCommentsPipeline(input: {
  workspace: string;
  threadIds: string[];
}): PipelinePhase[] {
  const { workspace, threadIds } = input;
  const wanted = new Set(threadIds);

  return [
    {
      kind: "function",
      label: VALIDATE_PR_COMMENTS_PHASE_LABEL,
      timeoutMs: validatePrCommentsBudgetMs(threadIds.length),
      // A retry re-runs every child on the same budget and re-spawns the whole
      // fan-out. The verdicts already written are durable, and the button is one
      // click away, so a human retrying the ones that failed is cheaper.
      maxRetries: 0,
      fn: async (ctx) => {
        const wsPath = path.join(getWorkspaceDir(), workspace);

        ctx.emitStatus(`Reading pull requests for ${workspace}...`);
        const { pullRequests, problems } = await listWorkspacePullRequests(workspace);
        for (const problem of problems) {
          ctx.emitStatus(`${problem.repoName}: ${problem.reason}`);
        }

        // Resolve each requested id against the PRs as they are now. An id the
        // tab showed can be gone by the time the button lands (the thread was
        // resolved, or the PR closed), and validating a thread that no longer
        // exists is not possible.
        const targets = pullRequests.flatMap((pr) =>
          pr.threads
            .filter((thread) => wanted.has(thread.id))
            .map((thread) => ({ pr, thread })),
        );

        const missing = [...wanted].filter(
          (id) => !targets.some((t) => t.thread.id === id),
        );
        if (missing.length > 0) {
          ctx.emitStatus(
            `${missing.length} selected thread(s) are no longer on the PR and were skipped`,
          );
        }

        if (targets.length === 0) {
          ctx.emitResult("No selected review threads could be found on the current PRs.");
          return false;
        }

        const systemPromptFile = ensureSystemPrompt(wsPath, "pr-comment-validator");
        const resultTexts = new Map<string, string>();

        const children: GroupChild[] = targets.map(({ pr, thread }) => ({
          label: `validate-${pr.repoName}-${thread.path ?? thread.id}`,
          prompt: buildPrCommentValidatorPrompt({
            workspaceName: workspace,
            repoName: pr.repoName,
            repoPath: pr.repoPath,
            worktreePath: pr.worktreePath,
            baseBranch: pr.baseRefName || "main",
            prUrl: pr.url,
            prTitle: pr.title,
            thread,
          }),
          cwd: pr.worktreePath,
          addDirs: [pr.worktreePath],
          // Read-only by construction rather than by prompt alone: setting
          // `allowedTools` at all replaces the Edit/Write grants `addDirs` would
          // otherwise generate, so listing only these leaves the validator unable
          // to write. Read / Grep / Glob need no grant, and `gh` is narrowed to
          // `pr view` so no `gh api` mutation is reachable.
          allowedTools: ["Bash(git:*)", "Bash(gh pr view:*)"],
          jsonSchema: PR_COMMENT_VALIDATION_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.VALIDATE_PR_COMMENT,
          appendSystemPromptFile: systemPromptFile,
          skipAskUserQuestion: true,
          onResultText: (text) => { resultTexts.set(thread.id, text); },
        }));

        ctx.emitStatus(`Validating ${children.length} review comment(s)...`);
        await ctx.runChildGroup(children);

        const validatedAt = new Date().toISOString();
        const validations: PrThreadValidation[] = [];
        const unreadable: string[] = [];

        for (const { pr, thread } of targets) {
          const parsed = parseValidationResult(resultTexts.get(thread.id) ?? "", {
            thread,
            repoName: pr.repoName,
            validatedAt,
          });
          if (parsed) validations.push(parsed);
          else unreadable.push(`${pr.repoName} ${thread.path ?? thread.id}`);
        }

        if (validations.length > 0) {
          await writePrValidations(wsPath, validations);
        }

        const counts = validations.reduce<Record<string, number>>((acc, v) => {
          acc[v.verdict] = (acc[v.verdict] ?? 0) + 1;
          return acc;
        }, {});
        const summary = ["valid", "invalid", "unclear"]
          .filter((v) => counts[v])
          .map((v) => `${counts[v]} ${v}`)
          .join(", ");

        const lines = [
          `Validated ${validations.length} of ${targets.length} review comment(s)${summary ? `: ${summary}` : ""}.`,
          ...validations.map(
            (v) => `- **${v.verdict}** — ${v.interpretation || v.commentUrl}\n  - ${v.recommendation}`,
          ),
        ];
        if (unreadable.length > 0) {
          lines.push(`\nNo verdict returned for: ${unreadable.join(", ")}. Re-run validate on those.`);
        }
        lines.push("\nOpen the workspace's Pull Requests tab to triage them.");
        ctx.emitResult(lines.join("\n"));

        // Some verdicts recorded is a useful outcome even if a child died; only a
        // clean sweep of failures is a failed phase.
        return validations.length > 0;
      },
    },
  ];
}
