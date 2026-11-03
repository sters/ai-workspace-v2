import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listBenchRuns } from "@/lib/db/bench-runs";
import { listClaudeRunsForOperation } from "@/lib/db";
import { summarizeBench } from "@/lib/bench/summary";
import { BENCH_STEPS } from "@/lib/bench/steps";
import { priceRun } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const RECENT = 30;

/** Recent benches with a per-pairing summary. `basis` prices them as on Run Costs (`1h` default, `5m`, `cli`). */
export async function GET(request: NextRequest) {
  const basis = request.nextUrl.searchParams.get("basis");
  const steps = [...BENCH_STEPS.values()].map((s) => ({ stepType: s.stepType, label: s.label, perRepo: s.perRepo }));
  const runs = listBenchRuns(RECENT).map((run) => {
    const costs = new Map(
      listClaudeRunsForOperation(run.operationId).map((r) => [
        r.childLabel ?? "",
        { costUsd: basis === "cli" ? r.costUsd : priceRun(r, basis === "5m" ? "5m" : "1h"), durationMs: r.durationMs },
      ]),
    );
    return { ...run, summary: summarizeBench(run.step, run.reference, run.attempts, costs) };
  });
  return NextResponse.json({ steps, runs });
}
