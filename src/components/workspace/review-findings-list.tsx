"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useReviewFindings } from "@/hooks/use-workspace";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { Callout } from "../shared/containers/callout";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusBadge } from "../shared/feedback/status-badge";
import { StatusText } from "../shared/feedback/status-text";
import { Textarea } from "../shared/forms/textarea";
import { cn } from "@/lib/utils";
import type {
  AnchoredReviewFinding,
  PostCommentsResponse,
  RepoReviewFindings,
} from "@/types/review-findings";

const ANCHOR_LABEL: Record<AnchoredReviewFinding["anchor"], string> = {
  inline: "inline",
  file: "file-level",
  "pr-body": "review body",
};

const ANCHOR_HINT: Record<AnchoredReviewFinding["anchor"], string> = {
  inline: "Will be posted on this line",
  file: "GitHub cannot anchor this to a line, so it goes on the file",
  "pr-body": "Not in the PR's diff, so it goes in the review's body",
};

/**
 * Which findings are ticked when the list first renders.
 *
 * Critical and Warning at medium confidence or better — the same bar the
 * autonomous gate loops on. Suggestions and low-confidence findings render but
 * stay unticked: they are the ones whose posting would fill someone else's PR
 * with things nobody has to act on, which is the whole reason this is a selection
 * rather than a "post the review" button.
 */
function isDefaultSelected(finding: AnchoredReviewFinding, hasPr: boolean): boolean {
  if (!hasPr || finding.posted) return false;
  if (finding.confidence === "low") return false;
  return finding.severity === "critical" || finding.severity === "warning";
}

function FindingRow({
  finding,
  selected,
  onToggle,
  editedBody,
  onEditBody,
  disabled,
}: {
  finding: AnchoredReviewFinding;
  selected: boolean;
  onToggle: (id: string) => void;
  editedBody: string | undefined;
  onEditBody: (id: string, body: string | undefined) => void;
  disabled: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const location = `${finding.path}${finding.line !== null ? `:${finding.line}` : ""}`;
  const body = editedBody ?? finding.body;

  return (
    <div
      className={cn(
        "border-t px-4 py-3 first:border-t-0",
        selected && "bg-accent/40",
        finding.posted && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={selected}
          disabled={disabled || finding.posted}
          onChange={() => onToggle(finding.id)}
          aria-label={`Select finding at ${location}`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge
              label={finding.severity}
              variant={`severity-${finding.severity}`}
              shape="square"
            />
            <code className="truncate text-xs font-medium">{location}</code>
            <StatusBadge
              label={ANCHOR_LABEL[finding.anchor]}
              variant={finding.anchor === "inline" ? "muted" : "check-queued"}
              shape="square"
              title={finding.anchorReason ?? ANCHOR_HINT[finding.anchor]}
            />
            {finding.confidence !== "high" && (
              <StatusBadge
                label={`confidence: ${finding.confidence}`}
                variant="muted"
                shape="square"
              />
            )}
            {finding.side === "LEFT" && (
              <StatusBadge
                label="removed code"
                variant="muted"
                shape="square"
                title="Anchored to the pre-change side of the diff"
              />
            )}
            {finding.posted && (
              <StatusBadge
                label="posted"
                variant="completed"
                shape="square"
                title="A comment for this finding is already on the PR"
              />
            )}
          </div>

          <p className="text-sm font-medium">{finding.title}</p>

          {isEditing ? (
            <div className="mt-1.5 space-y-2">
              <Textarea
                value={body}
                onChange={(e) => onEditBody(finding.id, e.target.value)}
                rows={4}
                disabled={disabled}
              />
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setIsEditing(false)}>
                  Done
                </Button>
                {editedBody !== undefined && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onEditBody(finding.id, undefined);
                      setIsEditing(false);
                    }}
                  >
                    Revert
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-0.5 text-sm">
              <MarkdownRenderer content={body} />
              {finding.suggestion && (
                <pre className="mt-1.5 overflow-x-auto rounded-md border bg-muted/50 p-2 text-xs">
                  <code>{finding.suggestion}</code>
                </pre>
              )}
              <div className="mt-1 flex items-center gap-2">
                <Button variant="ghost" onClick={() => setIsEditing(true)} disabled={disabled}>
                  Edit comment
                </Button>
                {editedBody !== undefined && (
                  <StatusText className="text-xs">edited</StatusText>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoSection({
  repo,
  selectedIds,
  onToggle,
  edited,
  onEditBody,
  disabled,
}: {
  repo: RepoReviewFindings;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  edited: Record<string, string>;
  onEditBody: (id: string, body: string | undefined) => void;
  disabled: boolean;
}) {
  return (
    <Card variant="flush">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-medium">{repo.repoName}</span>
        {repo.pr ? (
          <a
            href={repo.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm hover:underline"
          >
            #{repo.pr.number} <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <StatusBadge label="no PR" variant="muted" shape="square" />
        )}
        {repo.pr?.staleWorktree && (
          <StatusBadge
            label="worktree behind PR head"
            variant="investigation"
            shape="square"
            title="Line numbers were computed from the local checkout, which is not at the PR's head commit"
          />
        )}
        {repo.pr?.hasPendingReview && (
          <StatusBadge
            label="pending review exists"
            variant="failed"
            shape="square"
            title="GitHub allows one pending review per PR — submit or discard it before posting"
          />
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {repo.findings.length} finding{repo.findings.length === 1 ? "" : "s"}
        </span>
      </div>

      {repo.problem && (
        <div className="border-b px-4 py-2">
          <StatusText className="text-xs">{repo.problem}</StatusText>
        </div>
      )}

      {repo.findings.map((finding) => (
        <FindingRow
          key={finding.id}
          finding={finding}
          selected={selectedIds.has(finding.id)}
          onToggle={onToggle}
          editedBody={edited[finding.id]}
          onEditBody={onEditBody}
          disabled={disabled || !repo.pr}
        />
      ))}
    </Card>
  );
}

/**
 * The review's findings, offered one by one for posting on the PR.
 *
 * The list is complete — every finding the reviewer recorded is here, at the
 * severity it gave — and the *selection* is what narrows it. That split is
 * deliberate: `REVIEW_COVERAGE_POLICY` has the reviewer report everything
 * precisely so filtering happens downstream, and here the filter is a human.
 */
export function ReviewFindingsList({
  workspaceName,
  timestamp,
}: {
  workspaceName: string;
  timestamp: string;
}) {
  const { repos, isLoading, error, refresh } = useReviewFindings(workspaceName, timestamp);
  const { isWorkspaceRunning } = useRunningOperations();
  // The anchors were resolved against the worktree's diff, so an operation
  // editing it means the line numbers on screen are not the ones that would be
  // posted.
  const isRunning = isWorkspaceRunning(workspaceName);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [submitNow, setSubmitNow] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [result, setResult] = useState<PostCommentsResponse | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const withFindings = useMemo(() => repos.filter((r) => r.findings.length > 0), [repos]);

  const findingsById = useMemo(() => {
    const map = new Map<string, { repo: RepoReviewFindings; finding: AnchoredReviewFinding }>();
    for (const repo of withFindings) {
      for (const finding of repo.findings) map.set(finding.id, { repo, finding });
    }
    return map;
  }, [withFindings]);

  // Seed the default selection once per set of findings. Keyed on the ids so a
  // refresh that changed nothing does not undo the human's own ticking.
  const seedKey = useMemo(() => [...findingsById.keys()].sort().join(","), [findingsById]);
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;
    const next = new Set<string>();
    for (const { repo, finding } of findingsById.values()) {
      if (isDefaultSelected(finding, repo.pr !== null)) next.add(finding.id);
    }
    setSelectedIds(next);
  }, [seedKey, findingsById]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onEditBody = (id: string, body: string | undefined) =>
    setEdited((prev) => {
      if (body === undefined) {
        const { [id]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: body };
    });

  const selectAllPostable = () => {
    const next = new Set<string>();
    for (const { repo, finding } of findingsById.values()) {
      if (repo.pr && !finding.posted) next.add(finding.id);
    }
    setSelectedIds(next);
  };

  const handlePost = async () => {
    setIsPosting(true);
    setPostError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceName)}/reviews/${timestamp}/post-comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submit: submitNow,
            findings: [...selectedIds].map((id) => ({
              id,
              ...(edited[id] !== undefined ? { body: edited[id] } : {}),
            })),
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      setResult((await res.json()) as PostCommentsResponse);
      setSelectedIds(new Set());
      // Re-read so the findings that landed come back marked posted.
      await refresh();
    } catch (err) {
      setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPosting(false);
    }
  };

  if (isLoading) return <StatusText>Loading findings…</StatusText>;

  if (error) {
    return (
      <Callout variant="info">
        <p className="text-sm font-medium">Could not read this review&apos;s findings</p>
        <StatusText className="mt-1">{String(error)}</StatusText>
      </Callout>
    );
  }

  if (withFindings.length === 0) {
    return (
      <Card variant="dashed">
        <StatusText>
          This review recorded no structured findings, so there is nothing to post. Reviews run
          before this feature existed only have their markdown reports.
        </StatusText>
      </Card>
    );
  }

  const failures = result?.results.filter((r) => r.status === "failed") ?? [];
  const posted = result?.results.filter((r) => r.status === "posted").length ?? 0;
  const skipped = result?.results.filter((r) => r.status === "skipped").length ?? 0;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Post findings on the PR</h3>
          <StatusText className="text-xs">
            Ticked findings are posted as one review per repository. Critical and Warning are
            pre-selected; the rest are here to be chosen.
          </StatusText>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={selectAllPostable} disabled={isRunning || isPosting}>
            Select all
          </Button>
          <Button variant="outline" onClick={() => refresh()} disabled={isPosting}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {result && (
        <Callout variant={failures.length > 0 ? "error" : "info"}>
          <p className="text-sm font-medium">
            {posted} comment{posted === 1 ? "" : "s"} posted
            {skipped > 0 && `, ${skipped} already on the PR`}
            {failures.length > 0 && `, ${failures.length} failed`}
          </p>
          {result.reviews.map((review) => (
            <StatusText key={review.repoName} className="mt-1 block text-xs">
              <span className="font-medium">{review.repoName}</span>:{" "}
              {review.problem ??
                (review.pending
                  ? "left pending — submit it on GitHub to publish"
                  : "submitted")}
              {review.reviewUrl && (
                <>
                  {" "}
                  <a
                    href={review.reviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    open on GitHub
                  </a>
                </>
              )}
            </StatusText>
          ))}
          {failures.map((f) => (
            <StatusText key={f.id} className="mt-1 block text-xs">
              {f.id}: {f.reason}
            </StatusText>
          ))}
        </Callout>
      )}

      {postError && (
        <Callout variant="error">
          <p className="text-sm font-medium">Posting failed</p>
          <StatusText className="mt-1">{postError}</StatusText>
        </Callout>
      )}

      {withFindings.map((repo) => (
        <RepoSection
          key={repo.repoName}
          repo={repo}
          selectedIds={selectedIds}
          onToggle={toggle}
          edited={edited}
          onEditBody={onEditBody}
          disabled={isRunning || isPosting}
        />
      ))}

      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.size} finding{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={submitNow}
                  onChange={(e) => setSubmitNow(e.target.checked)}
                  disabled={isRunning || isPosting}
                />
                Submit immediately
              </label>
              <Button
                variant="primary"
                disabled={isRunning || isPosting}
                onClick={handlePost}
                title={
                  submitNow
                    ? "Post and publish the review on the PR"
                    : "Post as a pending review — you submit it on GitHub"
                }
              >
                {isPosting ? "Posting…" : submitNow ? "Post & submit" : "Post as pending"}
              </Button>
            </div>
            {isRunning && (
              <StatusText className="w-full text-xs">
                An operation is running for this workspace — its edits would move the lines these
                comments point at.
              </StatusText>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
