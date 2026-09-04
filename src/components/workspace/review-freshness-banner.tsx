"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useReviewFreshness, useWorkspace } from "@/hooks/use-workspace";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { Button } from "../shared/buttons/button";
import { Callout } from "../shared/containers/callout";
import { formatReviewTimestamp } from "@/lib/utils";
import type { RepoReviewFreshness } from "@/types/review-freshness";

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 8) : "unknown";
}

function repoLine(repo: RepoReviewFreshness): string {
  const moved = `${shortSha(repo.lastReviewedSha)} → ${shortSha(repo.prHeadSha)}`;
  return repo.updatedSinceReview
    ? `${repo.repoName}: reviewed at ${shortSha(repo.lastReviewedSha)}, PR head is now ${shortSha(repo.prHeadSha)} (${moved})`
    : `${repo.repoName}: worktree is at ${shortSha(repo.localHead)}, PR head is ${shortSha(repo.prHeadSha)}`;
}

/**
 * "The PR moved since this was reviewed" — and the button that acts on it.
 *
 * Re-review is a separate action from Review because it **mutates the
 * worktree**: it fetches and fast-forwards each repo onto the branch it tracks
 * before reading anything. That is the only way a second review of an updated
 * PR sees the new commits, and it is also why it is not the default — on a
 * workspace whose branch the pipeline itself is writing, moving HEAD is the
 * wrong thing to do.
 *
 * Renders nothing when there is nothing to act on, which is the common case:
 * no PR, never reviewed, or a review that still describes the PR head.
 */
export function ReviewFreshnessBanner({ workspaceName }: { workspaceName: string }) {
  const { workspace } = useWorkspace(workspaceName);
  const { repos, anyUpdatedSinceReview, isLoading, refresh } =
    useReviewFreshness(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);

  const updated = repos.filter((r) => r.updatedSinceReview);
  // Behind the PR head without having moved since the review: a worktree that
  // was never refreshed, so even a first review of these repos reads old code.
  const staleOnly = repos.filter((r) => !r.updatedSinceReview && r.worktreeStale);

  if (isLoading || !workspace) return null;
  if (updated.length === 0 && staleOnly.length === 0) return null;

  const isRunning = isWorkspaceRunning(workspaceName);
  const shown = updated.length > 0 ? updated : staleOnly;
  const lastReviewedAt = updated.find((r) => r.lastReviewedAt)?.lastReviewedAt ?? null;

  return (
    <Callout variant={anyUpdatedSinceReview ? "warning" : "info"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <div className="font-medium">
            {updated.length > 0
              ? `The pull request has new commits since the last review${
                  lastReviewedAt ? ` (${formatReviewTimestamp(lastReviewedAt)})` : ""
                }`
              : "The worktree is not at the pull request's head commit"}
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {shown.map((repo) => (
              <li key={repo.repoName} className="flex items-center gap-1.5">
                <span className="font-mono">{repoLine(repo)}</span>
                {repo.prUrl && (
                  <a
                    href={repo.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center hover:text-foreground"
                    aria-label={`Open ${repo.repoName} pull request`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          <div className="text-xs text-muted-foreground">
            Re-review fetches each worktree onto its tracked branch first, then reviews only
            what changed since the last review.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => refresh()} aria-label="Re-check the pull request">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            onClick={() =>
              startAndNavigate("review", {
                workspace: workspace.path,
                refreshFromRemote: true,
              })
            }
            disabled={isRunning}
          >
            Re-review
          </Button>
        </div>
      </div>
    </Callout>
  );
}
