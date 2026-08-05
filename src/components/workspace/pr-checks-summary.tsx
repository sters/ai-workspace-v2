"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { StatusBadge } from "../shared/feedback/status-badge";
import { Button } from "../shared/buttons/button";
import type { PrCheckState, PrChecksSummary } from "@/types/pull-request";

const STATE_LABEL: Record<PrCheckState, string> = {
  failure: "failing",
  running: "running",
  queued: "queued",
  success: "passed",
  skipped: "skipped",
  cancelled: "cancelled",
  unknown: "unknown",
};

const STATE_VARIANT: Record<PrCheckState, string> = {
  failure: "op-failed",
  running: "op-running",
  queued: "check-queued",
  success: "op-completed",
  skipped: "muted",
  cancelled: "muted",
  unknown: "muted",
};

/**
 * The PR's CI, as one badge that expands into the failing checks.
 *
 * Collapsed by default and opened by a failure, because the only rows anyone
 * reads are the ones that did not pass — a green PR needs a badge, not a list.
 */
export function PrChecksSummaryView({ checks }: { checks: PrChecksSummary }) {
  const [expanded, setExpanded] = useState(false);

  // "No CI configured" is not "everything passed", so it gets its own wording
  // rather than a green badge.
  if (!checks.reported) {
    return <StatusBadge label="CI: unknown" variant="muted" shape="square" title="GitHub reported no checks for this PR" />;
  }
  if (checks.checks.length === 0) {
    return <StatusBadge label="CI: none" variant="muted" shape="square" />;
  }

  const { counts } = checks;
  // Headline in the order a reader cares about: something broke, then something
  // is still happening, then a result. `queued` is its own rung — reporting a
  // not-yet-started job as "running" is a claim about work that has not begun.
  const headline: { label: string; variant: string } =
    counts.failure > 0
      ? { label: `CI: ${counts.failure} failing`, variant: "op-failed" }
      : counts.running > 0
        ? { label: `CI: ${counts.running} running`, variant: "op-running" }
        : counts.queued > 0
          ? { label: `CI: ${counts.queued} queued`, variant: "check-queued" }
          : counts.success > 0
            ? { label: `CI: ${counts.success} passed`, variant: "op-completed" }
            : // Only skipped / cancelled / unknown left: nothing ran to a verdict,
              // which is not a pass.
              { label: "CI: no result", variant: "muted" };

  const inFlightOrBroken = (state: PrCheckState) =>
    state === "failure" || state === "running" || state === "queued";
  const shown = expanded ? checks.checks : checks.checks.filter((c) => inFlightOrBroken(c.state));

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${headline.label} — toggle check details`}
      >
        <StatusBadge label={headline.label} variant={headline.variant} shape="square" />
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {(expanded || counts.failure > 0) && shown.length > 0 && (
        <ul className="mt-1 w-full space-y-0.5 text-xs">
          {shown.map((check) => (
            <li key={`${check.name}-${check.state}`} className="flex items-center gap-2">
              <StatusBadge
                label={STATE_LABEL[check.state]}
                variant={STATE_VARIANT[check.state]}
                shape="square"
              />
              <span className="truncate">{check.name}</span>
              {check.url && (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  logs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
          {!expanded && checks.checks.length > shown.length && (
            <li>
              <Button variant="ghost" onClick={() => setExpanded(true)}>
                Show all {checks.checks.length} checks
              </Button>
            </li>
          )}
        </ul>
      )}
    </>
  );
}
