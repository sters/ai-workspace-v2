import { listClaudeRuns } from "@/lib/db";
import { summarizeClaudeRuns } from "@/lib/run-costs";
import { priceRun } from "@/lib/pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `days` = 0 (or absent) covers everything recorded. `basis` picks the cost:
 * `1h` / `5m` reprice tokens at list rates with that cache-write TTL (the
 * default is `1h`); `cli` keeps what the CLI reported.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const days = Math.max(Number(params.get("days")) || 0, 0);
  const since = days > 0 ? new Date(Date.now() - days * DAY_MS).toISOString() : "";
  const basis = params.get("basis");
  const runs = listClaudeRuns(since);
  const priced = basis === "cli" ? runs : runs.map((r) => ({ ...r, costUsd: priceRun(r, basis === "5m" ? "5m" : "1h") }));
  return Response.json(summarizeClaudeRuns(priced));
}
