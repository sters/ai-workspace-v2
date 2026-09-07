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
 * The split is the point. Everything with one right answer — fetch, merge,
 * verify, commit, push — is deterministic TypeScript in `base-merge.ts`, and the
 * agent is given exactly the part that needs judgment: the content of the
 * conflicted files. It cannot commit or push its own work, so the leftover-marker
 * check always runs between a resolution and someone else's pull request.
 *
 * One phase rather than three (merge → resolve → push), because the children are
 * only known once the merges have run, and a group phase built after the fact
 * would need the merge to survive an `appendPhases` boundary in a worktree the
 * rest of the pipeline can also touch. The whole thing is short and the log
 * carries a line per repository per step.
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

export const RESOLVE_BASE_CONFLICTS_PHASE_LABEL = "Merge base into PR branches";

/**
 * Budget for the whole phase.
 *
 * Per repository rather than flat: the resolver children run concurrently but
 * queue behind `getMaxGroupConcurrency()`, and a budget sized for one repository
 * would kill the tail of a wide workspace. Generous per repository because a
 * conflict that spans a renamed module is real reading, and a timeout here kills
 * a merge mid-resolution.
 */
export function resolveBaseConflictsBudgetMs(repoCount: number): number {
  const PER_REPO_MS = 12 * 60 * 1000;
  const BASE_MS = 5 * 60 * 1000;
  return BASE_MS + Math.max(1, repoCount) * PER_REPO_MS;
}

export interface ConflictResolutionReport {
  resolvedFiles: { path: string; side: string; note: string }[];
  unresolvedFiles: { path: string; question: string }[];
  summary: string;
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
  // requests found at run time: the PRs themselves are read inside the phase, so
  // they are not available while the budget is being set.
  const repoCount = repository ? 1 : Math.max(1, listWorkspaceRepos(workspace).length);

  return [
    {
      kind: "function",
      label: RESOLVE_BASE_CONFLICTS_PHASE_LABEL,
      timeoutMs: resolveBaseConflictsBudgetMs(repoCount),
      // A retry would re-run every merge from scratch on the same budget, and the
      // repositories that already pushed would come back `already-current` while
      // the one that failed fails the same way. The button is one click away.
      maxRetries: 0,
      fn: async (ctx) => {
        const wsPath = path.join(getWorkspaceDir(), workspace);

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

        // Deterministic first pass: every repository either gets its merge
        // commit, stops on conflicts, or is left alone with a reason.
        const attempts: { pr: WorkspacePullRequest; attempt: BaseMergeAttempt }[] = [];
        for (const pr of targets) {
          const baseBranch = pr.baseRefName || "main";
          ctx.emitStatus(`${pr.repoName}: merging origin/${baseBranch} into ${pr.headRefName}...`);
          const attempt = mergeBaseIntoBranch(
            { repoName: pr.repoName, worktreePath: pr.worktreePath },
            { baseBranch, expectedBranch: pr.headRefName },
          );
          ctx.emitStatus(`[${attempt.stage}] ${attempt.detail}`);
          attempts.push({ pr, attempt });
        }

        // The one part with no right answer: the content of the conflicted files.
        const conflicted = attempts.filter((a) => a.attempt.stage === "conflicted");
        const reports = new Map<string, ConflictResolutionReport | null>();

        // Worktrees currently holding an in-progress merge. Emptied as each one
        // is committed or rolled back, and drained by the catch below — a kill or
        // a blown budget mid-resolution would otherwise leave a worktree
        // mid-merge, which is dirty to every later phase and holds a resolution
        // nothing verified.
        const openMerges = new Map<string, string>(
          conflicted.map(({ pr }) => [pr.repoName, pr.worktreePath]),
        );

        try {
          if (conflicted.length > 0) {
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
              // they are withheld by `finalizeConflictedMerge` owning them.
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
            await ctx.runChildGroup(children);

            for (const { pr } of conflicted) {
              const report = parseConflictResolution(resultTexts.get(pr.repoName) ?? "");
              reports.set(pr.repoName, report);
              if (report) {
                ctx.emitStatus(
                  `${pr.repoName}: ${report.summary || `${report.resolvedFiles.length} file(s) resolved`}`,
                );
                for (const file of report.unresolvedFiles) {
                  ctx.emitStatus(`${pr.repoName}: ${file.path} left unresolved — ${file.question}`);
                }
              }
            }
          }

          // Commit what was resolved, then push everything that gained a merge
          // commit. Both are deterministic, and both are per repository: one
          // rejected push says nothing about the others.
          const outcomes: BaseMergeOutcome[] = [];
          for (const { pr, attempt } of attempts) {
            const baseBranch = pr.baseRefName || "main";
            const record = {
              repoName: pr.repoName,
              prUrl: pr.url,
              baseBranch,
              conflictedFiles: attempt.conflictedFiles,
            };

            if (attempt.stage === "already-current" || attempt.stage === "dirty" || attempt.stage === "failed") {
              outcomes.push({
                ...record,
                status: attempt.stage === "already-current" ? "already-current" : attempt.stage,
                aiResolved: false,
                detail: attempt.detail,
              });
              continue;
            }

            const aiResolved = attempt.stage === "conflicted";
            let committedDetail = attempt.detail;

            if (aiResolved) {
              const finalized = finalizeConflictedMerge(
                { repoName: pr.repoName, worktreePath: pr.worktreePath },
                attempt.conflictedFiles,
              );
              openMerges.delete(pr.repoName);
              ctx.emitStatus(finalized.detail);
              if (!finalized.ok) {
                const report = reports.get(pr.repoName);
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

          // A repository left dirty, unresolved or unpushed is work this operation
          // was asked to do and did not, so the phase says so rather than reporting
          // success for the ones that happened to be easy.
          return outcomes.every((o) => !isBaseMergeProblem(o.status));
        } catch (err) {
          // Whatever went wrong, no worktree is left holding an unverified
          // merge: the resolutions in them were never checked for markers, and
          // a mid-merge worktree reads as dirty to every later phase.
          for (const [repoName, worktreePath] of openMerges) {
            abortMerge({ worktreePath });
            ctx.emitStatus(`${repoName}: the in-progress merge was rolled back`);
          }
          throw err;
        }
      },
    },
  ];
}
