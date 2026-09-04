/**
 * Whether each repository's pull request has moved since the last review
 * judged it.
 *
 * The two sides of the comparison already exist and were never put together:
 * `baseline.json` records what each worktree's HEAD was when a review ran, and
 * the PR read knows the head commit GitHub has. A review workspace's whole
 * reason to exist is a PR someone else keeps pushing to, and nothing on the
 * page said whether the newest review still describes it.
 *
 * `worktreeStale` is kept separate from `updatedSinceReview` because they lead
 * to different actions: a PR that moved calls for a re-review, while a worktree
 * behind the PR head is what makes that re-review read the wrong code — the
 * state the refresh phase exists to clear.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "./git";
import { getCachedPullRequests } from "./pr-cache";
import { captureRepoHead, readLatestReviewBaseline } from "./review-baseline";
import type { RepoReviewFreshness, ReviewFreshnessResult } from "@/types/review-freshness";

/**
 * One repository's verdict.
 *
 * Every comparison needs both shas present, and absence never counts as a
 * difference: a repo with no PR, no baseline, or an unreadable worktree is
 * reported as "nothing to say", not as stale. Prompting a re-review on missing
 * data would make the banner permanent on every workspace that has no PR.
 */
export function computeRepoFreshness(input: {
  repoName: string;
  localHead: string | null;
  lastReviewedSha: string | null;
  lastReviewedAt: string | null;
  pr: { url: string; headSha: string } | null;
}): RepoReviewFreshness {
  const { repoName, localHead, lastReviewedSha, lastReviewedAt, pr } = input;
  const prHeadSha = pr && pr.headSha !== "" ? pr.headSha : null;

  return {
    repoName,
    lastReviewedSha,
    lastReviewedAt,
    localHead,
    prUrl: pr?.url ?? null,
    prHeadSha,
    updatedSinceReview:
      prHeadSha !== null && lastReviewedSha !== null && prHeadSha !== lastReviewedSha,
    worktreeStale: prHeadSha !== null && localHead !== null && prHeadSha !== localHead,
  };
}

/**
 * Freshness for every repository in the workspace.
 *
 * The PR side comes through the same TTL cache the Pull Requests tab uses, so
 * having both open costs one read. The baseline and the worktree HEAD are local
 * and read every time.
 */
export async function loadReviewFreshness(
  workspace: string,
  opts?: { force?: boolean },
): Promise<ReviewFreshnessResult> {
  const wsPath = path.join(getWorkspaceDir(), workspace);
  const repos = listWorkspaceRepos(workspace);

  const [baseline, prs] = await Promise.all([
    readLatestReviewBaseline(wsPath),
    // A failure here leaves every repo without a PR side, which reports as
    // "nothing to say" rather than as an alarm.
    getCachedPullRequests(workspace, { force: opts?.force }).catch(() => ({
      pullRequests: [],
      problems: [],
    })),
  ]);

  const prByRepo = new Map(prs.pullRequests.map((pr) => [pr.repoName, pr]));

  const results = repos.map((repo) => {
    const pr = prByRepo.get(repo.repoName);
    return computeRepoFreshness({
      repoName: repo.repoName,
      localHead: captureRepoHead(repo.worktreePath),
      lastReviewedSha: baseline?.heads[repo.repoName] ?? null,
      lastReviewedAt: baseline?.heads[repo.repoName] ? baseline.timestamp : null,
      pr: pr ? { url: pr.url, headSha: pr.headSha } : null,
    });
  });

  return {
    repos: results,
    anyUpdatedSinceReview: results.some((r) => r.updatedSinceReview),
  };
}
