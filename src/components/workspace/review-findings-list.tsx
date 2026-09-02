"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useReviewFindings } from "@/hooks/use-workspace";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { Callout } from "../shared/containers/callout";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusBadge } from "../shared/feedback/status-badge";
import { StatusText } from "../shared/feedback/status-text";
import { cn } from "@/lib/utils";
import type {
  AnchoredReviewFinding,
  FindingGrounding,
  RepoReviewFindings,
} from "@/types/review-findings";

const ANCHOR_LABEL: Record<AnchoredReviewFinding["anchor"], string> = {
  inline: "inline",
  file: "file-level",
  "pr-body": "review body",
};

const ANCHOR_HINT: Record<AnchoredReviewFinding["anchor"], string> = {
  inline: "Would be posted on this line",
  file: "GitHub cannot anchor this to a line, so it would go on the file",
  "pr-body": "Not in the PR's diff, so it would go in the review's body",
};

/**
 * How a previous run's verdict reads on the row.
 *
 * Named by *why* it did not go out rather than by the field it came from: the
 * reader's question is what happened to this finding, and "refuted" or
 * "local-only" answers it where `holds: no` does not.
 */
function groundingLabel(grounding: FindingGrounding): string {
  if (grounding.posted) return "posted";
  if (grounding.holds === "no") return "refuted";
  if (grounding.holds === "unclear") return "unclear";
  if (grounding.scope === "local-only") return "local-only";
  if (grounding.scope === "pre-existing") return "pre-existing";
  return "not posted";
}

/**
 * Which findings are ticked when the list first renders.
 *
 * Critical and Warning at medium confidence or better — the same bar the
 * autonomous gate loops on. Suggestions and low-confidence findings render but
 * stay unticked, and so does anything a previous run already checked and
 * declined: re-grounding a refuted finding on every visit spends a child to
 * reach the verdict already on the row.
 */
function isDefaultSelected(
  finding: AnchoredReviewFinding,
  hasPr: boolean,
  grounding: FindingGrounding | undefined,
): boolean {
  if (!hasPr || finding.posted) return false;
  if (grounding) return false;
  if (finding.confidence === "low") return false;
  return finding.severity === "critical" || finding.severity === "warning";
}

function FindingRow({
  finding,
  grounding,
  selected,
  onToggle,
  disabled,
}: {
  finding: AnchoredReviewFinding;
  grounding: FindingGrounding | undefined;
  selected: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  const location = `${finding.path}${finding.line !== null ? `:${finding.line}` : ""}`;

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
            {grounding && !finding.posted && (
              <StatusBadge
                label={groundingLabel(grounding)}
                variant={grounding.posted ? "completed" : "verdict-invalid"}
                shape="square"
                title={`Checked against the code ${grounding.groundedAt}`}
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
          <div className="mt-0.5 text-sm">
            <MarkdownRenderer content={finding.body} />
          </div>

          {grounding && (
            <div className="mt-2 rounded-md border border-dashed p-2.5 text-xs">
              <p className="mb-1 font-medium">
                {grounding.posted
                  ? "Posted after checking against the code"
                  : `Not posted — ${groundingLabel(grounding)}`}
              </p>
              {grounding.reason && (
                <p className="text-muted-foreground">{grounding.reason}</p>
              )}
              {grounding.posted && grounding.comment && (
                <div className="mt-1.5 border-t pt-1.5">
                  <MarkdownRenderer content={grounding.comment} />
                </div>
              )}
              {grounding.evidence.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  Evidence:{" "}
                  {grounding.evidence.map((e) => (
                    <code key={e} className="mr-1.5">{e}</code>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoSection({
  repo,
  groundings,
  selectedIds,
  onToggle,
  disabled,
}: {
  repo: RepoReviewFindings;
  groundings: Record<string, FindingGrounding>;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
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
          grounding={groundings[finding.id]}
          selected={selectedIds.has(finding.id)}
          onToggle={onToggle}
          disabled={disabled || !repo.pr}
        />
      ))}
    </Card>
  );
}

/**
 * The review's findings, offered for posting on the PR.
 *
 * The selection is a set of **candidates**, not of comments. Each one is checked
 * against the pushed code by its own agent, and that check decides whether it is
 * posted at all and writes the comment in the repository's own conventions — a
 * review finding is a claim, and `REVIEW_COVERAGE_POLICY` has the reviewer report
 * claims it is unsure of on purpose.
 *
 * The list itself stays complete for the same reason: filtering belongs
 * downstream, and here downstream is a human choosing candidates and then an
 * agent checking them.
 */
export function ReviewFindingsList({
  workspaceName,
  timestamp,
}: {
  workspaceName: string;
  timestamp: string;
}) {
  const { repos, groundings, isLoading, error, refresh } = useReviewFindings(
    workspaceName,
    timestamp,
  );
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);
  // The anchors were resolved against the worktree's diff, so an operation
  // editing it means the line numbers on screen are not the ones that would be
  // posted — and the grounding children would read that tree mid-edit.
  const isRunning = isWorkspaceRunning(workspaceName);

  // The selection carries the finding set it was seeded for, so re-seeding is a
  // comparison during render rather than an effect — see below.
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({
    key: "",
    ids: new Set(),
  });
  const [submitNow, setSubmitNow] = useState(false);

  const withFindings = useMemo(() => repos.filter((r) => r.findings.length > 0), [repos]);

  const findingsById = useMemo(() => {
    const map = new Map<string, { repo: RepoReviewFindings; finding: AnchoredReviewFinding }>();
    for (const repo of withFindings) {
      for (const finding of repo.findings) map.set(finding.id, { repo, finding });
    }
    return map;
  }, [withFindings]);

  // Keyed on the ids, not on the fetch: a refresh that changed nothing must not
  // undo the human's own ticking.
  const seedKey = useMemo(() => [...findingsById.keys()].sort().join(","), [findingsById]);

  const defaultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { repo, finding } of findingsById.values()) {
      if (isDefaultSelected(finding, repo.pr !== null, groundings[finding.id])) {
        ids.add(finding.id);
      }
    }
    return ids;
  }, [findingsById, groundings]);

  // Adjusted during render rather than in an effect: the default selection is
  // derived from the data, and an effect would paint one frame of the wrong
  // selection before correcting it.
  if (selection.key !== seedKey) setSelection({ key: seedKey, ids: defaultIds });
  const selectedIds = selection.key === seedKey ? selection.ids : defaultIds;

  const setSelectedIds = (ids: Set<string>) => setSelection({ key: seedKey, ids });

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  /**
   * Everything that could be posted: a finding needs a PR to go on and must not
   * already be there. Also the ceiling the toggle compares against, so a
   * selection can never look short of "all" because of a row nobody can tick.
   */
  const postableIds = useMemo(() => {
    const ids: string[] = [];
    for (const { repo, finding } of findingsById.values()) {
      if (repo.pr && !finding.posted) ids.push(finding.id);
    }
    return ids;
  }, [findingsById]);

  const allSelected = postableIds.length > 0 && selectedIds.size === postableIds.length;

  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(postableIds));

  const handleStart = async () => {
    await startAndNavigate("post-review-findings", {
      workspace: workspaceName,
      reviewTimestamp: timestamp,
      findingIds: [...selectedIds],
      submit: String(submitNow),
    });
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

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Post findings on the PR</h3>
          <StatusText className="text-xs">
            Each ticked finding is checked against the pushed code first; only the ones that hold
            and belong to this PR are commented, in the repository&apos;s own conventions.
          </StatusText>
        </div>
        <div className="flex items-center gap-2">
          {/* One button, not a Select all here and a Clear in the action bar:
              undoing the default selection was otherwise a trip to the bottom of
              a long list. */}
          {postableIds.length > 0 && (
            <Button variant="ghost" onClick={toggleAll} disabled={isRunning}>
              {allSelected ? "Clear selection" : `Select all (${postableIds.length})`}
            </Button>
          )}
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {withFindings.map((repo) => (
        <RepoSection
          key={repo.repoName}
          repo={repo}
          groundings={groundings}
          selectedIds={selectedIds}
          onToggle={toggle}
          disabled={isRunning}
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
                  disabled={isRunning}
                />
                Submit immediately
              </label>
              <Button
                variant="primary"
                disabled={isRunning}
                onClick={handleStart}
                title={
                  submitNow
                    ? "Check each finding against the code, then publish the surviving comments"
                    : "Check each finding against the code, then leave the surviving comments in a pending review"
                }
              >
                Ground &amp; post
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
