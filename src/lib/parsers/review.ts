import type { ReviewSession } from "@/types/workspace";

export function parseReviewSummary(
  timestamp: string,
  content: string
): ReviewSession {
  const reposMatch = content.match(/\*\*Repositories Reviewed\*\*:\s*(\d+)/);

  // Sum counts from per-repo Code Review tables:
  // | Critical Issues | {count} |
  // | Warnings | {count} |
  // | Suggestions | {count} |
  const criticalMatches = content.matchAll(
    /\|\s*Critical Issues\s*\|\s*(\d+)\s*\|/g
  );
  const warningMatches = content.matchAll(
    /\|\s*Warnings\s*\|\s*(\d+)\s*\|/g
  );
  const suggestionMatches = content.matchAll(
    /\|\s*Suggestions\s*\|\s*(\d+)\s*\|/g
  );

  let critical = 0;
  for (const m of criticalMatches) critical += parseInt(m[1], 10);
  let warnings = 0;
  for (const m of warningMatches) warnings += parseInt(m[1], 10);
  let suggestions = 0;
  for (const m of suggestionMatches) suggestions += parseInt(m[1], 10);

  return {
    timestamp,
    repos: parseInt(reposMatch?.[1] ?? "0", 10),
    critical,
    warnings,
    suggestions,
  };
}
