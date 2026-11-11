"use client";

import { Button, Callout } from "@/components/shared";
import type { PrSuggestions } from "@/lib/pr-watcher/suggestions";

/**
 * The watcher's proposals for this workspace's PRs. Each is a button; nothing
 * runs until it is pressed. "Select for triage" only fills the selection, so
 * the comments and checks can be read before the existing Triage starts.
 */
export function PrSuggestionsCallout({
  suggestions,
  triageCount,
  disabled,
  onSelectTriage,
  onDismissTriage,
  onResolveConflicts,
  onArchive,
}: {
  suggestions: PrSuggestions;
  /** Comments and checks the triage proposal would select that are still on the tab. */
  triageCount: { comments: number; checks: number };
  disabled: boolean;
  onSelectTriage: () => void;
  onDismissTriage: () => void;
  onResolveConflicts: () => void;
  onArchive: () => void;
}) {
  const showTriage = suggestions.triage !== null && triageCount.comments + triageCount.checks > 0;
  if (!showTriage && suggestions.conflicts.length === 0 && !suggestions.archive) return null;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <Callout variant="info" className="space-y-2 text-sm">
      <p className="font-medium">Suggested</p>
      {showTriage && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Triage{" "}
            {[
              triageCount.comments > 0 && plural(triageCount.comments, "new comment"),
              triageCount.checks > 0 && plural(triageCount.checks, "failing check"),
            ]
              .filter(Boolean)
              .join(" and ")}
          </span>
          <Button variant="outline" onClick={onSelectTriage} disabled={disabled}>
            Select for triage
          </Button>
          <Button variant="outline-muted" onClick={onDismissTriage}>
            Dismiss
          </Button>
        </div>
      )}
      {suggestions.conflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Conflicts with the base branch: {suggestions.conflicts.join(", ")}</span>
          <Button variant="outline" onClick={onResolveConflicts} disabled={disabled}>
            Resolve conflicts
          </Button>
        </div>
      )}
      {suggestions.archive && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Every pull request is merged.</span>
          <Button variant="outline" onClick={onArchive} disabled={disabled}>
            Archive workspace
          </Button>
        </div>
      )}
    </Callout>
  );
}
