import type { UsageLimitStop } from "@/types/operation";
import { listLatestOperationPerWorkspace } from "../db";

/**
 * How the CLI words an exhausted allowance. Non-exhaustive: the noun varies by
 * which allowance ran out ("session", "weekly", a model's own), and an
 * unrecognized wording costs the sidebar indicator, nothing more.
 *
 * Both patterns stay on one line, since the only text they are ever matched
 * against that is *not* a CLI error is an agent's prose — and a report is free
 * to discuss rate limiting without the run having hit one.
 */
const USAGE_LIMIT_PATTERNS = [
  /you'?ve hit your[^\n]*\blimit\b/i,
  /usage limit reached/i,
];

/** Whether an operation's last result is the CLI reporting an exhausted allowance. */
export function isUsageLimitMessage(content: string | undefined): boolean {
  if (!content) return false;
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Workspaces whose **latest** operation died on a usage limit — nothing is
 * running there and the run did not finish, so the branch is mid-work and
 * nobody has been told.
 *
 * Read from the operation's `resultSummary`, which the limit's own error is:
 * once the allowance is gone every child exits instantly with it, so it is the
 * last result the pipeline recorded before giving up. Scoped to the latest
 * operation because a later run supersedes the report — including a running
 * one, which is why that is not filtered out of the query.
 */
export function listUsageLimitStops(): UsageLimitStop[] {
  const stops: UsageLimitStop[] = [];
  for (const op of listLatestOperationPerWorkspace()) {
    if (op.status !== "failed") continue;
    const message = op.resultSummary?.content;
    if (!message || !isUsageLimitMessage(message)) continue;
    stops.push({
      workspace: op.workspace,
      operationId: op.id,
      message,
      ...(op.completedAt && { at: op.completedAt }),
    });
  }
  return stops;
}
