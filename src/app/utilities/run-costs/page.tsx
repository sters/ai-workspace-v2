"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { CostGroup, RunCostSummary } from "@/lib/run-costs";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher } from "@/lib/api";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;
const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;
const kTokens = (n: number) => `${Math.round(n / 1000)}k`;

function GroupTable({ title, groups, total }: { title: string; groups: CostGroup[]; total: number }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3 font-medium">Key</th>
              <th className="py-1 pr-3 text-right font-medium">Cost</th>
              <th className="py-1 pr-3 text-right font-medium">Share</th>
              <th className="py-1 pr-3 text-right font-medium">Runs</th>
              <th className="py-1 pr-3 text-right font-medium">$/run</th>
              <th className="py-1 pr-3 text-right font-medium">Time</th>
              <th className="py-1 pr-3 text-right font-medium" title="Output tokens per run">Out/run</th>
              <th className="py-1 text-right font-medium" title="Cache-write tokens per run">Cache write/run</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-border">
                <td className="py-1 pr-3 font-mono text-xs">{g.key}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{usd(g.costUsd)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{total > 0 ? `${Math.round((g.costUsd / total) * 100)}%` : "-"}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{g.runs}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{usd(g.costUsd / g.runs)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{minutes(g.durationMs)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{kTokens(g.outputTokens / g.runs)}</td>
                <td className="py-1 text-right tabular-nums">{kTokens(g.cacheCreationTokens / g.runs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function RunCostsPage() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading } = useSWR<RunCostSummary>(`/api/run-costs?days=${days}`, fetcher);
  const total = data?.totalCostUsd ?? 0;

  return (
    <div>
      <PageHeader
        title="Run Costs"
        description="What each pipeline step spent on Claude, from the cost the CLI reports per child run. Time is summed over runs, so parallel children overlap."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button key={r.days} variant={r.days === days ? "primary" : "outline-muted"} onClick={() => setDays(r.days)}>
            {r.label}
          </Button>
        ))}
      </div>

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch run costs.</StatusText>}
      {data && data.runs === 0 && <StatusText>No runs recorded in this range.</StatusText>}

      {data && data.runs > 0 && (
        <div className="grid gap-4">
          <div className="text-sm text-muted-foreground">
            {usd(total)} over {data.runs} runs in {data.operations} operations ({usd(total / data.operations)} per operation)
          </div>
          <GroupTable title="By operation type" groups={data.byOperationType} total={total} />
          <GroupTable title="By phase" groups={data.byPhase} total={total} />
          <GroupTable title="By step type" groups={data.byStep} total={total} />
          <GroupTable title="By model" groups={data.byModel} total={total} />
          <GroupTable title="By effort" groups={data.byEffort} total={total} />
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Most expensive operations</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {data.topOperations.map((op) => (
                    <tr key={op.operationId} className="border-t border-border first:border-t-0">
                      <td className="py-1 pr-3 text-right tabular-nums">{usd(op.costUsd)}</td>
                      <td className="py-1 pr-3">{op.operationType}</td>
                      <td className="py-1 pr-3">
                        <Link
                          className="underline"
                          href={`/workspace/${encodeURIComponent(op.workspace)}/operations?operationId=${encodeURIComponent(op.operationId)}`}
                        >
                          {op.workspace}
                        </Link>
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{op.runs} runs</td>
                      <td className="py-1 text-xs text-muted-foreground">{new Date(op.startedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
