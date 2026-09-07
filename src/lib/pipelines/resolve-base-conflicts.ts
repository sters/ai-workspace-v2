/**
 * `resolve-base-conflicts` — the operation behind the TODO forms' **Solve PR
 * base branch conflicts** button.
 *
 * For each open pull request the workspace's worktrees have: merge its base
 * branch back in with `--no-ff`, hand any conflicts to an agent, and push as
 * soon as the merge is committed. A workspace worktree is cut from
 * `origin/<base>` once and never moves, so this is the state a PR drifts into
 * on its own while the base advances.
 *
 * The split between deterministic work and the agent is the point. Everything
 * with one right answer — fetch, merge, verify, commit, push — is TypeScript in
 * `base-merge.ts`, and the agent is given exactly the part that needs judgment:
 * the content of the conflicted files. It cannot commit or push its own work, so
 * the leftover-marker check always runs between a resolution and someone else's
 * pull request.
 *
 * **Three phases, one per thing that can go wrong**, sharing a `MergeRun` object
 * from the closure: `Merge base branches` → `Resolve conflicts` → `Commit and
 * push`. It began as one phase, on the reasoning that the children are only
 * known once the merges have run and a mid-merge worktree should not outlive a
 * phase boundary. That bought nothing a reader could use: one box in the
 * operation log covered three different failures — a merge that never ran, a
 * resolution that did not hold, a push the remote rejected — and each phase's
 * own budget and result line is what tells them apart at a glance.
 *
 * What it costs is that a conflicted worktree is now mid-merge *between* phases,
 * so each phase owns a rollback: `Resolve conflicts` rolls back what it broke or
 * was interrupted in, and `Commit and push` rolls back anything that fails its
 * check. A kill landing between phases still leaves a merge in progress, and the
 * next run reports exactly that rather than merging on top of it (`mergeBase
 * IntoBranch` refuses a worktree with `MERGE_HEAD`).
 *
 * The phases are also why the first two return `true` for a repository-level
 * problem: a failed phase aborts the pipeline (`execute-phases.ts`), which would
 * skip both the rollback and the push of a *different* repository's clean merge.
 * The run's verdict belongs to the last phase, which is the one that knows what
 * landed.
 *
 * What this deliberately does NOT do is verify the merge: no lint, no test, no
 * build. The pull request's own CI runs against the pushed merge commit, which
 * is where a bad resolution shows up, and the Pull Requests tab already triages a
 * red check into a fix. The phase result says so rather than implying the merge
 * was checked.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import {
  buildConflictResolverPrompt,
  CONFLICT_RESOLUTION_SCHEMA,
} from "@/lib/templates/prompts/conflict-resolver";
import {
  abortMerge,
  finalizeConflictedMerge,
  isBaseMergeProblem,
  mergeBaseIntoBranch,
  pushMergedBranch,
  summarizeBaseMergeAttempts,
  summarizeBaseMerges,
  type BaseMergeAttempt,
  type BaseMergeOutcome,
} from "@/lib/workspace/base-merge";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { listWorkspacePullRequests } from "@/lib/workspace/pr-threads";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhase } from "@/types/pipeline";
import type { WorkspacePullRequest } from "@/types/pull-request";

export const MERGE_BASE_PHASE_LABEL = "Merge base branches";
export const RESOLVE_CONFLICTS_PHASE_LABEL = "Resolve conflicts";
export const PUSH_MERGE_PHASE_LABEL = "Commit and push";

/**
 * Budgets, one per phase, all per repository.
 *
 * Per repository rather than flat because the resolver children queue behind
 * `getMaxGroupConcurrency()` and the git commands run in series, so a budget
 * sized for one repository would kill the tail of a wide workspace mid-merge.
 * The merge phase is not instant either: its `git fetch` of a large repository
 * is the slowest deterministic thing here.
 */
export function mergeBasePhaseBudgetMs(repoCount: number): number {
  return 2 * 60 * 1000 + Math.max(1, repoCount) * 3 * 60 * 1000;
}

export function resolveConflictsPhaseBudgetMs(repoCount: number): number {
  return 5 * 60 * 1000 + Math.max(1, repoCount) * 12 * 60 * 1000;
}

export function pushMergePhaseBudgetMs(repoCount: number): number {
  return 2 * 60 * 1000 + Math.max(1, repoCount) * 2 * 60 * 1000;
}

export interface ConflictResolutionReport {
  resolvedFiles: { path: string; side: string; note: string }[];
  unresolvedFiles: { path: string; question: string }[];
  summary: string;
}

/** What the three phases hand each other. */
interface MergeRun {
  attempts: { pr: WorkspacePullRequest; attempt: BaseMergeAttempt }[];
  reports: Map<string, ConflictResolutionReport | null>;
  /** repoName → why, for merges rolled back before the push phase saw them. */
  rolledBack: Map<string, string>;
}

/**
 * Read one resolver child's structured output.
 *
 * Returns null when there is nothing readable. That is not the same as "no
 * resolution happened": what gets committed is decided by
 * `finalizeConflictedMerge` reading git, so an unreadable report costs the log
 * its explanation and nothing else.
 */
export function parseConflictResolution(raw: string): ConflictResolutionReport | null {
  if (!raw.trim()) return null;

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const objects = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
      : [];

  return {
    resolvedFiles: objects(json.resolvedFiles)
      .map((f) => ({ path: str(f.path), side: str(f.side), note: str(f.note) }))
      .filter((f) => f.path !== ""),
    unresolvedFiles: objects(json.unresolvedFiles)
      .map((f) => ({ path: str(f.path), question: str(f.question) }))
      .filter((f) => f.path !== ""),
    summary: str(json.summary),
  };
}

/** The open pull requests this run acts on, narrowed to one repository if asked. */
export function selectTargetPullRequests(
  pullRequests: WorkspacePullRequest[],
  repository?: string,
): WorkspacePullRequest[] {
  const open = pullRequests.filter((pr) => pr.state === "OPEN");
  if (!repository) return open;
  return open.filter((pr) => pr.repoPath === repository || pr.repoName === repository);
}

export function buildResolveBaseConflictsPipeline(input: {
  workspace: string;
  /** Single-repo filter, matching the review pipeline's `repository` option. */
  repository?: string;
}): PipelinePhase[] {
  const { workspace, repository } = input;

  // Sized from the worktrees on disk, which is an upper bound on the pull
  // requests found at run time: the PRs themselves are read inside the first
  // phase, so they are not available while the budgets are being set.
  const repoCount = repository ? 1 : Math.max(1, listWorkspaceRepos(workspace).length);

  // One object per built pipeline, captured by all three phases. Nothing here
  // survives the operation, which is what keeps two concurrent runs on different
  // workspaces from seeing each other's merges.
  const run: MergeRun = { attempts: [], reports: new Map(), rolledBack: new Map() };

  /** Repositories whose merge is still open, i.e. awaiting the push phase. */
  const openMerges = () =>
    run.attempts.filter(
      ({ pr, attempt }) => attempt.stage === "conflicted" && !run.rolledBack.has(pr.repoName),
    );

  return [
    {
      kind: "function",
      label: MERGE_BASE_PHASE_LABEL,
      timeoutMs: mergeBasePhaseBudgetMs(repoCount),
      // A retry re-runs every merge from scratch on the same budget, and a
      // repository that already merged comes back `already-current` while the
      // one that failed fails the same way. The button is one click away.
      maxRetries: 0,
      fn: async (ctx) => {
        ctx.emitStatus(`Reading pull requests for ${workspace}...`);
        const { pullRequests, problems } = await listWorkspacePullRequests(workspace);
        for (const problem of problems) {
          ctx.emitStatus(`${problem.repoName}: ${problem.reason}`);
        }

        const targets = selectTargetPullRequests(pullRequests, repository);
        if (targets.length === 0) {
          ctx.emitResult(
            repository
              ? `No open pull request on ${repository}'s branch, so there is no base branch to merge in.`
              : "No open pull requests on this workspace's branches, so there is no base branch to merge in.",
          );
          return true;
        }

        for (const pr of targets) {
          const baseBranch = pr.baseRefName || "main";
          ctx.emitStatus(`${pr.repoName}: merging origin/${baseBranch} into ${pr.headRefName}...`);
          const attempt = mergeBaseIntoBranch(
            { repoName: pr.repoName, worktreePath: pr.worktreePath },
            {
              baseBranch,
              expectedBranch: pr.headRefName,
              // `headRefOid` — the commit GitHub judged the PR's mergeability
              // from. Without it the verdict is about the worktree, which is
              // how an unpushed merge came back as "already contains".
              prHeadSha: pr.headSha,
            },
          );
          ctx.emitStatus(`[${attempt.stage}] ${attempt.detail}`);
          run.attempts.push({ pr, attempt });
        }

        ctx.emitResult(summarizeBaseMergeAttempts(run.attempts.map((a) => a.attempt)));

        // A repository left dirty or refused is reported here and settled by the
        // push phase. Failing would abort the pipeline, which would skip both
        // the rollback of the merges this phase opened and the push of the ones
        // that merged cleanly.
        return true;
      },
    },
    {
      kind: "function",
      label: RESOLVE_CONFLICTS_PHASE_LABEL,
      timeoutMs: resolveConflictsPhaseBudgetMs(repoCount),
      maxRetries: 0,
      fn: async (ctx) => {
        const conflicted = openMerges();
        if (conflicted.length === 0) {
          ctx.emitResult("No conflicts to resolve.");
          return true;
        }

        const wsPath = path.join(getWorkspaceDir(), workspace);

        /**
         * Roll back every merge this phase is leaving behind unfinished. The
         * resolutions in them were never checked for markers, and a worktree
         * left mid-merge is dirty to every later phase — including the next run
         * of this operation, which refuses to merge on top of one.
         */
        const rollbackOpen = (why: string) => {
          for (const { pr } of openMerges()) {
            abortMerge({ worktreePath: pr.worktreePath });
            run.rolledBack.set(pr.repoName, `${pr.repoName}: ${why} The merge was rolled back, so the branch is unchanged.`);
            ctx.emitStatus(`${pr.repoName}: the in-progress merge was rolled back`);
          }
        };

        const systemPromptFile = ensureSystemPrompt(wsPath, "conflict-resolver");
        const resultTexts = new Map<string, string>();

        const children: GroupChild[] = conflicted.map(({ pr, attempt }) => ({
          label: `resolve-conflicts-${pr.repoName}`,
          prompt: buildConflictResolverPrompt({
            workspaceName: workspace,
            repoName: pr.repoName,
            repoPath: pr.repoPath,
            worktreePath: pr.worktreePath,
            branch: attempt.branch,
            baseBranch: pr.baseRefName || "main",
            prUrl: pr.url,
            prTitle: pr.title,
            conflictedFiles: attempt.conflictedFiles,
          }),
          cwd: pr.worktreePath,
          // No explicit `allowedTools`: the generated grants are Edit/Write
          // inside this worktree plus `Bash(git:*)`, which is what resolving
          // needs. The commit and the push are not withheld by the grants —
          // they are withheld by the next phase owning them.
          addDirs: [pr.worktreePath],
          jsonSchema: CONFLICT_RESOLUTION_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.RESOLVE_CONFLICTS,
          appendSystemPromptFile: systemPromptFile,
          skipAskUserQuestion: true,
          onResultText: (text) => { resultTexts.set(pr.repoName, text); },
        }));

        ctx.emitStatus(
          `Resolving conflicts in ${children.length} repositor${children.length === 1 ? "y" : "ies"}...`,
        );

        try {
          await ctx.runChildGroup(children);
        } catch (err) {
          rollbackOpen(`the conflict resolution failed: ${err}.`);
          ctx.emitResult(`Conflict resolution failed: ${err}`);
          // True so the push phase still runs: another repository's clean merge
          // is still worth pushing, and the summary belongs there.
          return true;
        }

        if (ctx.signal.aborted) {
          rollbackOpen("the operation was interrupted while conflicts were being resolved.");
          ctx.emitResult("Interrupted while resolving conflicts. Every in-progress merge was rolled back.");
          return false;
        }

        const lines: string[] = [];
        for (const { pr, attempt } of conflicted) {
          const report = parseConflictResolution(resultTexts.get(pr.repoName) ?? "");
          run.reports.set(pr.repoName, report);

          if (!report) {
            // The verdict comes from git in the next phase either way; this only
            // costs the log its explanation.
            lines.push(
              `- ${pr.repoName}: no readable report from the resolver — the staged result is checked in the next phase`,
            );
            continue;
          }

          ctx.emitStatus(
            `${pr.repoName}: ${report.summary || `${report.resolvedFiles.length} file(s) resolved`}`,
          );
          lines.push(
            `- **${pr.repoName}** — ${report.summary || `${report.resolvedFiles.length} of ${attempt.conflictedFiles.length} file(s) resolved`}`,
          );
          for (const file of report.resolvedFiles) {
            lines.push(`  - \`${file.path}\` (${file.side || "resolved"}): ${file.note}`);
          }
          for (const file of report.unresolvedFiles) {
            ctx.emitStatus(`${pr.repoName}: ${file.path} left unresolved — ${file.question}`);
            lines.push(`  - \`${file.path}\` **left unresolved**: ${file.question}`);
          }
        }

        ctx.emitResult(
          [
            `Resolved conflicts in ${conflicted.length} repositor${conflicted.length === 1 ? "y" : "ies"}. ` +
              `Nothing is committed yet — the next phase checks the staged result before it can be pushed.`,
            "",
            ...lines,
          ].join("\n"),
        );
        return true;
      },
    },
    {
      kind: "function",
      label: PUSH_MERGE_PHASE_LABEL,
      timeoutMs: pushMergePhaseBudgetMs(repoCount),
      maxRetries: 0,
      fn: async (ctx) => {
        if (run.attempts.length === 0) return true;

        const outcomes: BaseMergeOutcome[] = [];
        for (const { pr, attempt } of run.attempts) {
          const record = {
            repoName: pr.repoName,
            prUrl: pr.url,
            baseBranch: pr.baseRefName || "main",
            conflictedFiles: attempt.conflictedFiles,
          };

          const rolledBack = run.rolledBack.get(pr.repoName);
          if (rolledBack) {
            outcomes.push({ ...record, status: "unresolved", aiResolved: true, detail: rolledBack });
            continue;
          }

          // Nothing to push: either it is genuinely done, or this repository was
          // left alone with a reason. `stale` reports as failed — the worktree
          // is behind the pushed head, which is a state to fix, not a merge that
          // happened.
          const settled =
            attempt.stage === "already-current" ? ("already-current" as const)
            : attempt.stage === "dirty" ? ("dirty" as const)
            : attempt.stage === "failed" || attempt.stage === "stale" ? ("failed" as const)
            : null;
          if (settled) {
            outcomes.push({ ...record, status: settled, aiResolved: false, detail: attempt.detail });
            continue;
          }

          // `clean` and `unpushed` both go straight to the push; only
          // `conflicted` needs the resolution checked and committed first.
          const aiResolved = attempt.stage === "conflicted";
          let committedDetail = attempt.detail;

          if (aiResolved) {
            const finalized = finalizeConflictedMerge(
              { repoName: pr.repoName, worktreePath: pr.worktreePath },
              attempt.conflictedFiles,
            );
            ctx.emitStatus(finalized.detail);
            if (!finalized.ok) {
              const report = run.reports.get(pr.repoName);
              const questions = (report?.unresolvedFiles ?? [])
                .map((f) => `\n  - \`${f.path}\`: ${f.question}`)
                .join("");
              outcomes.push({
                ...record,
                status: "unresolved",
                aiResolved: true,
                detail: `${finalized.detail}${questions}`,
              });
              continue;
            }
            committedDetail = finalized.detail;
          }

          const pushed = pushMergedBranch(
            { repoName: pr.repoName, worktreePath: pr.worktreePath },
            attempt.branch,
          );
          ctx.emitStatus(pushed.detail);
          outcomes.push({
            ...record,
            status: pushed.ok ? "pushed" : "push-failed",
            aiResolved,
            detail: pushed.ok ? `${committedDetail}; pushed to \`${attempt.branch}\`` : pushed.detail,
          });
        }

        ctx.emitResult(summarizeBaseMerges(outcomes));

        // The run's verdict lives here, in the phase that knows what landed: a
        // repository left dirty, unresolved or unpushed is work this operation
        // was asked to do and did not.
        return outcomes.every((o) => !isBaseMergeProblem(o.status));
      },
    },
  ];
}
