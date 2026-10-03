"use client";

import { Textarea } from "../shared/forms/textarea";

/**
 * The note box a ticked thread or check opens. What is written here travels with
 * the item to Chat, Validate and Triage, so a human can say how they want it
 * handled instead of leaving the choice to the run.
 */
export function PrSelectionNote({
  label,
  value,
  onChange,
  className,
}: {
  /** Names what the note is on, for the accessible name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Textarea
      aria-label={`Note on ${label}`}
      className={className}
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="How you want this handled (optional) — e.g. “A, B or C would work; A looks best. If there's a better option, use that.”"
    />
  );
}
