"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { usePullRequests } from "@/hooks/use-workspace";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { Callout } from "../shared/containers/callout";
import { StatusBadge } from "../shared/feedback/status-badge";
import { StatusText } from "../shared/feedback/status-text";
import { PrReviewThreadRow } from "./pr-review-thread";
import { isTriageableCheck, PrChecksSummaryView } from "./pr-checks-summary";
import {
  buildTriagePrCommentsInstruction,
  type TriageCiFailure,
  type TriageThread,
} from "@/lib/templates/prompts/triage-pr-comments";
import { chatPagePath, stashChatHandoff } from "@/lib/chat-handoff";
import { buildPrChatTopic } from "@/lib/pr-chat-topic";
import { loadPrNotes, savePrNotes } from "@/lib/pr-notes";
import type {
  PrCheck,
  PrCheckFailureLog,
  PrReviewThread,
  WorkspacePullRequest,
} from "@/types/pull-request";

/** Flatten a thread's comments into the single block a triage instruction quotes. */
function flattenComments(thread: PrReviewThread): string {
  return thread.comments
    .map((c) => `${c.author}:\n${c.body}`)
    .join("\n\n--- reply ---\n\n");
}

function toTriageThread(
  pr: WorkspacePullRequest,
  thread: PrReviewThread,
  note: string | undefined,
): TriageThread {
  return {
    note,
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

/**
 * Selection key for a failing check.
 *
 * A check has no id of its own, so it is identified by where it sits: the repo,
 * the name GitHub reports, and the details url — a matrix job repeats a name
 * across runs but not a url.
 */
function checkKey(pr: WorkspacePullRequest, check: PrCheck): string {
  return [pr.repoName, check.name, check.url ?? ""].join("\u0000");
}

/**
 * Read the selected checks' logs, then hand them to the instruction builder.
 *
 * A failed read is not a failed triage: the instruction has a shape for "no log
 * could be read" that sends the item to reproduce locally, which is worth more
 * than refusing to start. Logs come back one per request entry, in order.
 */
async function loadCiFailures(
  workspaceName: string,
  targets: { pr: WorkspacePullRequest; check: PrCheck }[],
): Promise<TriageCiFailure[]> {
  const withoutLog = (reason: string): TriageCiFailure[] =>
    targets.map(({ pr, check }) => ({
      repoName: pr.repoName,
      name: check.name,
      url: check.url,
      prUrl: pr.url,
      excerpt: null,
      truncated: false,
      reason,
    }));

  try {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceName)}/pr-check-logs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: targets.map(({ pr, check }) => ({
            repoName: pr.repoName,
            name: check.name,
            url: check.url,
          })),
        }),
      },
    );
    if (!res.ok) throw new Error(await res.text());

    const { logs } = (await res.json()) as { logs: PrCheckFailureLog[] };
    if (!Array.isArray(logs) || logs.length !== targets.length) {
      throw new Error("the log endpoint returned an unexpected shape");
    }
    return logs.map((log, i) => ({ ...log, prUrl: targets[i].pr.url }));
  } catch (err) {
    console.error("Failed to read CI logs for triage:", err);
    return withoutLog(
      `the dashboard could not read it (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export function PullRequestsView({ workspaceName }: { workspaceName: string }) {
  const { pullRequests, problems, validations, isLoading, error, refresh } =
    usePullRequests(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const router = useRouter();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedCheckKeys, setSelectedCheckKeys] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  // The log read is a `gh` round trip per check, so the click has to say it is
  // doing something before the operation page takes over.
  const [isReadingLogs, setIsReadingLogs] = useState(false);
  // Keyed like the selections (thread id, check key). Unticking keeps a note, so
  // a box ticked again gets back what was written in it.
  const [notes, setNotes] = useState<Record<string, string>>(() => loadPrNotes(workspaceName));

  const updateNotes = (update: (prev: Record<string, string>) => Record<string, string>) =>
    setNotes((prev) => {
      const next = update(prev);
      savePrNotes(workspaceName, next);
      return next;
    });

  const setNote = (key: string, note: string) =>
    updateNotes((prev) => {
      const next = { ...prev };
      if (note) next[key] = note;
      else delete next[key];
      return next;
    });

  const noteFor = (key: string): string | undefined => notes[key]?.trim() || undefined;

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

  const failuresByKey = useMemo(() => {
    const map = new Map<string, { pr: WorkspacePullRequest; check: PrCheck }>();
    for (const pr of pullRequests) {
      for (const check of pr.checks.checks) {
        if (isTriageableCheck(check)) map.set(checkKey(pr, check), { pr, check });
      }
    }
    return map;
  }, [pullRequests]);

  const resolvedCount = useMemo(
    () => pullRequests.reduce((n, pr) => n + pr.threads.filter((t) => t.isResolved).length, 0),
    [pullRequests],
  );

  const visibleThreads = (pr: WorkspacePullRequest) =>
    showResolved ? pr.threads : pr.threads.filter((t) => !t.isResolved);

  const toggleIn = (setter: typeof setSelectedIds) => (key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggle = toggleIn(setSelectedIds);
  const toggleCheck = toggleIn(setSelectedCheckKeys);

  const visibleThreadIds = pullRequests.flatMap((pr) => visibleThreads(pr).map((t) => t.id));
  const totalVisible = visibleThreadIds.length + failuresByKey.size;

  const selectAllVisible = () => {
    setSelectedIds(new Set(visibleThreadIds));
    setSelectedCheckKeys(new Set(failuresByKey.keys()));
  };

  /**
   * The repository to scope the triage run to, or `undefined` for the workspace.
   *
   * `repo` reaches update-todo, execute, review and create-pr, so passing it is
   * what stops a comment on one worktree spending an Execute + Review on every
   * other one (and it drops the cross-repo reviewer, which has no boundary to
   * judge). It is a single value in the autonomous API, so a selection spanning
   * repositories cannot be expressed and falls back to the whole workspace.
   */
  const scopedRepo = useMemo(() => {
    const names = new Set<string>();
    for (const id of selectedIds) {
      const entry = threadsById.get(id);
      if (entry) names.add(entry.pr.repoName);
    }
    for (const key of selectedCheckKeys) {
      const entry = failuresByKey.get(key);
      if (entry) names.add(entry.pr.repoName);
    }
    return names.size === 1 ? [...names][0] : undefined;
  }, [selectedIds, selectedCheckKeys, threadsById, failuresByKey]);

  // A thread that scrolled out of view because the resolved filter changed is
  // still selected, so the counts are taken from the selections themselves.
  const selectedCount = selectedIds.size + selectedCheckKeys.size;
  const selectionLabel = `${[
    selectedIds.size > 0 ? `${selectedIds.size} comment${selectedIds.size === 1 ? "" : "s"}` : null,
    selectedCheckKeys.size > 0
      ? `${selectedCheckKeys.size} CI failure${selectedCheckKeys.size === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(", ")} selected`;

  const handleValidate = async () => {
    const threadIds = [...selectedIds];
    const threadNotes = Object.fromEntries(
      threadIds.flatMap((id) => {
        const note = noteFor(id);
        return note ? [[id, note]] : [];
      }),
    );
    await startAndNavigate("validate-pr-comments", {
      workspace: workspaceName,
      threadIds,
      ...(Object.keys(threadNotes).length > 0 && { notes: threadNotes }),
    });
  };

  const handleTriage = async () => {
    const threads = [...selectedIds]
      .map((id) => threadsById.get(id))
      .filter((entry): entry is { pr: WorkspacePullRequest; thread: PrReviewThread } => entry != null)
      .map(({ pr, thread }) => toTriageThread(pr, thread, noteFor(thread.id)));

    const checkTargets = [...selectedCheckKeys]
      .map((key) => failuresByKey.get(key))
      .filter((entry): entry is { pr: WorkspacePullRequest; check: PrCheck } => entry != null);

    if (threads.length === 0 && checkTargets.length === 0) return;

    let ciFailures: TriageCiFailure[] = [];
    if (checkTargets.length > 0) {
      setIsReadingLogs(true);
      try {
        const logs = await loadCiFailures(workspaceName, checkTargets);
        ciFailures = logs.map((failure, i) => ({
          ...failure,
          note: noteFor(checkKey(checkTargets[i].pr, checkTargets[i].check)),
        }));
      } finally {
        setIsReadingLogs(false);
      }
    }

    const sentKeys = [...selectedIds, ...selectedCheckKeys];
    const started = await startAndNavigate("autonomous", {
      workspace: workspaceName,
      startWith: "update-todo",
      instruction: buildTriagePrCommentsInstruction({ threads, ciFailures, validations }),
      interactionLevel: "low",
      ...(scopedRepo && { repo: scopedRepo }),
    });
    // Only a started run has consumed them: a refused one (the concurrency limit)
    // keeps what was written for the next try.
    if (started) {
      updateNotes((prev) => {
        const next = { ...prev };
        for (const key of sentKeys) delete next[key];
        return next;
      });
    }
  };

  const handleChat = () => {
    const threads = [...selectedIds]
      .map((id) => threadsById.get(id))
      .filter((entry): entry is { pr: WorkspacePullRequest; thread: PrReviewThread } => entry != null)
      .map(({ pr, thread }) => ({
        repoPath: pr.repoPath,
        prUrl: pr.url,
        path: thread.path,
        line: thread.line,
        comments: thread.comments,
        validation: validations[thread.id],
        note: noteFor(thread.id),
      }));
    const checks = [...selectedCheckKeys]
      .map((key) => failuresByKey.get(key))
      .filter((entry): entry is { pr: WorkspacePullRequest; check: PrCheck } => entry != null)
      .map(({ pr, check }) => ({
        repoPath: pr.repoPath,
        prUrl: pr.url,
        name: check.name,
        url: check.url,
        note: noteFor(checkKey(pr, check)),
      }));
    if (threads.length === 0 && checks.length === 0) return;

    stashChatHandoff(workspaceName, { discussion: buildPrChatTopic({ threads, checks }) });
    router.push(chatPagePath(workspaceName));
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
                <PrChecksSummaryView
                  checks={pr.checks}
                  keyOf={(check) => checkKey(pr, check)}
                  selectedKeys={selectedCheckKeys}
                  onToggle={toggleCheck}
                  disabled={isRunning}
                  notes={notes}
                  onNoteChange={setNote}
                />
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
                    note={notes[thread.id] ?? ""}
                    onNoteChange={setNote}
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
            <span className="text-sm font-medium">{selectionLabel}</span>
            {/* The scope is otherwise invisible — nothing on the page says which
                worktrees the run will touch. */}
            {scopedRepo && (
              <StatusText className="text-xs">· {scopedRepo} only</StatusText>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedIds(new Set());
                setSelectedCheckKeys(new Set());
              }}
            >
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {/* Not gated on a running operation: the chat it opens reads the
                  code and waits, changing nothing until asked. */}
              <Button
                variant="outline"
                onClick={handleChat}
                title="Start a chat about the selection, to talk it through before deciding"
              >
                <MessageSquare className="h-4 w-4" />
                Chat
              </Button>
              <Button
                variant="secondary"
                disabled={isRunning || selectedIds.size === 0}
                onClick={handleValidate}
                title={
                  selectedIds.size === 0
                    ? "Validate reads review comments — a failing check has no comment to interpret"
                    : "Have an agent work out what each comment is asking for and whether it holds"
                }
              >
                Validate
              </Button>
              <Button
                variant="primary"
                disabled={isRunning || isReadingLogs}
                onClick={handleTriage}
                title="Plan and implement the selection, then reply on the PR"
              >
                {isReadingLogs ? "Reading CI logs…" : "Triage"}
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
