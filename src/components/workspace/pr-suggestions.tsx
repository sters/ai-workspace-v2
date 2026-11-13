"use client";

import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Button, Callout } from "@/components/shared";
import { usePrSuggestions } from "@/hooks/use-pr-suggestions";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";

/** The query the Pull Requests tab reads to select the triage proposal on arrival. */
export const SELECT_TRIAGE_PARAM = "triage";

/**
 * The watcher's proposals for this workspace's PRs, shown on every tab. Each is
 * a button; nothing runs until it is pressed. "Select for triage" opens the
 * Pull Requests tab and only fills its selection, so the comments and checks
 * can be read before the existing Triage starts.
 */
export function WorkspaceSuggestions({
  workspaceName,
  onArchive,
}: {
  workspaceName: string;
  onArchive: () => void;
}) {
  const { suggestions, markHandled } = usePrSuggestions(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);
  if (!suggestions) return null;
  const { triage, conflicts, archive } = suggestions;
  if (!triage && conflicts.length === 0 && !archive) return null;

  const disabled = isWorkspaceRunning(workspaceName);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const prTab = `/workspace/${encodeURIComponent(workspaceName)}/pull-requests`;
  return (
    <Callout variant="info" className="space-y-1.5 py-2 text-sm">
      {triage && (
        <Row>
          <span>
            Triage{" "}
            {[
              triage.commentUrls.length > 0 && plural(triage.commentUrls.length, "new comment"),
              triage.failingRepos.length > 0 && `failing CI on ${triage.failingRepos.join(", ")}`,
            ]
              .filter(Boolean)
              .join(" and ")}
          </span>
          <Link
            href={`${prTab}?${SELECT_TRIAGE_PARAM}=select`}
            className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            Select for triage
          </Link>
          <Button variant="outline-muted" onClick={() => void markHandled()}>
            Dismiss
          </Button>
        </Row>
      )}
      {conflicts.length > 0 && (
        <Row>
          <span>Conflicts with the base branch: {conflicts.join(", ")}</span>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void startAndNavigate("resolve-base-conflicts", {
                workspace: workspaceName,
                ...(conflicts.length === 1 && { repo: conflicts[0] }),
              })
            }
          >
            Resolve conflicts
          </Button>
        </Row>
      )}
      {archive && (
        <Row>
          <span>Every pull request is merged.</span>
          <Button variant="outline" onClick={onArchive} disabled={disabled}>
            Archive workspace
          </Button>
        </Row>
      )}
    </Callout>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      {children}
    </div>
  );
}
