"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { usePullRequests } from "@/hooks/use-workspace";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { Callout } from "../shared/containers/callout";
import { StatusBadge } from "../shared/feedback/status-badge";
import { StatusText } from "../shared/feedback/status-text";
import { PrReviewThreadRow } from "./pr-review-thread";
import { PrChecksSummaryView } from "./pr-checks-summary";
import {
  buildTriagePrCommentsInstruction,
  type TriageThread,
} from "@/lib/templates/prompts/triage-pr-comments";
import type { PrReviewThread, WorkspacePullRequest } from "@/types/pull-request";

/** Flatten a thread's comments into the single block a triage instruction quotes. */
function flattenComments(thread: PrReviewThread): string {
  return thread.comments
    .map((c) => `${c.author}:\n${c.body}`)
    .join("\n\n--- reply ---\n\n");
}

function toTriageThread(pr: WorkspacePullRequest, thread: PrReviewThread): TriageThread {
  return {
    id: thread.id,
    repoName: pr.repoName,
    prUrl: pr.url,
    path: thread.path,
    line: thread.line,
    commentUrl: thread.comments[0]?.url ?? pr.url,
    author: thread.comments[0]?.author ?? "(unknown)",
    body: flattenComments(thread),
  };
}

export function PullRequestsView({ workspaceName }: { workspaceName: string }) {
  const { pullRequests, problems, validations, isLoading, error, refresh } =
    usePullRequests(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);

  // A validate reads the worktrees and a triage writes TODO files, so both would
  // be judging or planning against a tree another operation is editing.
  const isRunning = isWorkspaceRunning(workspaceName);

  const threadsById = useMemo(() => {
    const map = new Map<string, { pr: WorkspacePullRequest; thread: PrReviewThread }>();
    for (const pr of pullRequests) {
      for (const thread of pr.threads) map.set(thread.id, { pr, thread });
    }
    return map;
  }, [pullRequests]);

  const resolvedCount = useMemo(
    () => pullRequests.reduce((n, pr) => n + pr.threads.filter((t) => t.isResolved).length, 0),
    [pullRequests],
  );

  const visibleThreads = (pr: WorkspacePullRequest) =>
    showResolved ? pr.threads : pr.threads.filter((t) => !t.isResolved);

  const toggle = (threadId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });

  const visibleThreadIds = pullRequests.flatMap((pr) => visibleThreads(pr).map((t) => t.id));
  const totalVisible = visibleThreadIds.length;

  const selectAllVisible = () => setSelectedIds(new Set(visibleThreadIds));

  // A thread that scrolled out of view because the resolved filter changed is
  // still selected, so the count is taken from the selection itself.
  const selectedCount = selectedIds.size;

  const handleValidate = async () => {
    await startAndNavigate("validate-pr-comments", {
      workspace: workspaceName,
      threadIds: [...selectedIds],
    });
  };

  const handleTriage = async () => {
    const threads = [...selectedIds]
      .map((id) => threadsById.get(id))
      .filter((entry): entry is { pr: WorkspacePullRequest; thread: PrReviewThread } => entry != null)
      .map(({ pr, thread }) => toTriageThread(pr, thread));
    if (threads.length === 0) return;

    await startAndNavigate("autonomous", {
      workspace: workspaceName,
      startWith: "update-todo",
      instruction: buildTriagePrCommentsInstruction({ threads, validations }),
      interactionLevel: "low",
    });
  };

  if (isLoading) return <StatusText>Loading pull requests…</StatusText>;

  if (error) {
    return (
      <Callout variant="error">
        <p className="text-sm font-medium">Could not read pull requests</p>
        <StatusText className="mt-1">{String(error)}</StatusText>
      </Callout>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">
            {pullRequests.length} pull request{pullRequests.length === 1 ? "" : "s"}
          </h2>
          <StatusText className="text-xs">
            The PR on each repository&apos;s workspace branch.
          </StatusText>
        </div>
        <div className="flex items-center gap-2">
          {/* In the header rather than the action bar: the bar only appears once
              something is selected, and selecting all is what you want first. */}
          {totalVisible > 0 && (
            <Button variant="ghost" onClick={selectAllVisible} disabled={isRunning}>
              Select all shown
            </Button>
          )}
          {resolvedCount > 0 && (
            <Button variant="ghost" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide" : "Show"} {resolvedCount} resolved
            </Button>
          )}
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {problems.length > 0 && (
        <Callout variant="info">
          <p className="mb-1 text-sm font-medium">
            {problems.length} repositor{problems.length === 1 ? "y" : "ies"} without review threads
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {problems.map((p) => (
              <li key={p.repoName}>
                <span className="font-medium">{p.repoName}</span>: {p.reason}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {pullRequests.length === 0 ? (
        <Card variant="dashed">
          <StatusText>
            No pull request found on any of this workspace&apos;s branches yet. Run Create PR from
            the operations panel first.
          </StatusText>
        </Card>
      ) : (
        pullRequests.map((pr) => {
          const threads = visibleThreads(pr);
          return (
            <Card key={pr.url} variant="flush">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <span className="text-sm font-medium">{pr.repoName}</span>
                <StatusBadge
                  label={pr.isDraft ? "draft" : pr.state.toLowerCase()}
                  variant={
                    pr.isDraft
                      ? "muted"
                      : pr.state === "OPEN"
                        ? "op-running"
                        : pr.state === "MERGED"
                          ? "op-completed"
                          : "op-failed"
                  }
                  shape="square"
                />
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm hover:underline"
                >
                  #{pr.number} {pr.title} <ExternalLink className="h-3 w-3" />
                </a>
                <PrChecksSummaryView checks={pr.checks} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {pr.headRefName} → {pr.baseRefName} · {pr.threads.length} thread
                  {pr.threads.length === 1 ? "" : "s"}
                </span>
              </div>

              {threads.length === 0 ? (
                <div className="px-4 py-3">
                  <StatusText className="text-xs">
                    {pr.threads.length === 0
                      ? "No review comments on this PR."
                      : "All review threads on this PR are resolved."}
                  </StatusText>
                </div>
              ) : (
                threads.map((thread) => (
                  <PrReviewThreadRow
                    key={thread.id}
                    thread={thread}
                    validation={validations[thread.id]}
                    selected={selectedIds.has(thread.id)}
                    onToggle={toggle}
                    disabled={isRunning}
                  />
                ))
              )}
            </Card>
          );
        })
      )}

      {/* Action bar. Sticky so a selection made at the top of a long PR can be
          acted on without scrolling back. */}
      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {selectedCount} comment{selectedCount === 1 ? "" : "s"} selected
            </span>
            <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={isRunning}
                onClick={handleValidate}
                title="Have an agent work out what each comment is asking for and whether it holds"
              >
                Validate
              </Button>
              <Button
                variant="primary"
                disabled={isRunning}
                onClick={handleTriage}
                title="Plan and implement the selected comments, then reply on the PR"
              >
                Triage
              </Button>
            </div>
            {isRunning && (
              <StatusText className="w-full text-xs">
                An operation is already running for this workspace — wait for it to finish.
              </StatusText>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
