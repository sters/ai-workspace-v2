"use client";

import { ExternalLink } from "lucide-react";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusBadge } from "../shared/feedback/status-badge";
import { cn } from "@/lib/utils";
import type { PrReviewThread, PrThreadValidation } from "@/types/pull-request";

/**
 * One review thread: its comments, its recorded validation verdict if it has
 * one, and the checkbox that puts it into the selection the action bar acts on.
 *
 * The verdict renders inline under the comment rather than in a separate panel
 * because the two are read together — the question the validate button answers
 * is "what does *this* comment mean", so the answer belongs next to it.
 */
export function PrReviewThreadRow({
  thread,
  validation,
  selected,
  onToggle,
  disabled,
}: {
  thread: PrReviewThread;
  validation?: PrThreadValidation;
  selected: boolean;
  onToggle: (threadId: string) => void;
  disabled: boolean;
}) {
  const location = thread.path
    ? `${thread.path}${thread.line != null ? `:${thread.line}` : ""}`
    : "(not anchored to a file)";
  const firstComment = thread.comments[0];

  return (
    <div
      className={cn(
        "border-t px-4 py-3 first:border-t-0",
        selected && "bg-accent/40",
        thread.isResolved && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={selected}
          disabled={disabled}
          onChange={() => onToggle(thread.id)}
          aria-label={`Select review thread on ${location}`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <code className="truncate text-xs font-medium">{location}</code>
            {thread.isResolved && <StatusBadge label="resolved" variant="completed" shape="square" />}
            {thread.isOutdated && (
              <StatusBadge
                label="outdated"
                variant="muted"
                shape="square"
                title="The lines this thread points at have changed since it was written"
              />
            )}
            {validation && (
              <StatusBadge
                label={validation.verdict}
                variant={`verdict-${validation.verdict}`}
                shape="square"
                title={`Validated ${validation.validatedAt}`}
              />
            )}
            {firstComment?.url && (
              <a
                href={firstComment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                GitHub <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {thread.comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">(no readable comment body)</p>
          ) : (
            <div className="space-y-2">
              {thread.comments.map((comment, i) => (
                <div key={comment.url || i} className="text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {comment.author}
                    {i > 0 && " (reply)"}
                  </span>
                  <div className="mt-0.5 text-sm">
                    <MarkdownRenderer content={comment.body} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {validation && (
            <div className="mt-2 rounded-md border border-dashed p-2.5 text-xs">
              <p className="mb-1 font-medium">
                Validation: {validation.verdict}
              </p>
              <dl className="space-y-1 text-muted-foreground">
                {validation.interpretation && (
                  <div>
                    <dt className="inline font-medium">What it asks for: </dt>
                    <dd className="inline">{validation.interpretation}</dd>
                  </div>
                )}
                {validation.reasoning && (
                  <div>
                    <dt className="inline font-medium">Against the code: </dt>
                    <dd className="inline">{validation.reasoning}</dd>
                  </div>
                )}
                {validation.recommendation && (
                  <div>
                    <dt className="inline font-medium">Recommendation: </dt>
                    <dd className="inline">{validation.recommendation}</dd>
                  </div>
                )}
                {validation.evidence.length > 0 && (
                  <div>
                    <dt className="inline font-medium">Evidence: </dt>
                    <dd className="inline">
                      {validation.evidence.map((e) => (
                        <code key={e} className="mr-1.5">{e}</code>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
