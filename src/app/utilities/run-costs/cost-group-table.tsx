"use client";

import { useState } from "react";
import type { CostGroup } from "@/lib/run-costs";
import { Card } from "@/components/shared/containers/card";

export const usd = (n: number) => `$${n.toFixed(2)}`;
const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;
const kTokens = (n: number) => (n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

interface Column {
  label: string;
  title?: string;
  value: (g: CostGroup) => number | string;
  render: (g: CostGroup, total: number) => string;
}

const COLUMNS: Column[] = [
  { label: "Key", value: (g) => g.key, render: (g) => g.key },
  { label: "Cost", value: (g) => g.costUsd, render: (g) => usd(g.costUsd) },
  { label: "Share", value: (g) => g.costUsd, render: (g, total) => (total > 0 ? `${Math.round((g.costUsd / total) * 100)}%` : "-") },
  { label: "Runs", value: (g) => g.runs, render: (g) => String(g.runs) },
  { label: "$/run", value: (g) => g.costUsd / g.runs, render: (g) => usd(g.costUsd / g.runs) },
  { label: "Time", value: (g) => g.durationMs, render: (g) => minutes(g.durationMs) },
  { label: "In/run", title: "Uncached input tokens per run", value: (g) => g.inputTokens / g.runs, render: (g) => kTokens(g.inputTokens / g.runs) },
  { label: "Out/run", title: "Output tokens per run", value: (g) => g.outputTokens / g.runs, render: (g) => kTokens(g.outputTokens / g.runs) },
  { label: "Cache read/run", title: "Cache-read tokens per run", value: (g) => g.cacheReadTokens / g.runs, render: (g) => kTokens(g.cacheReadTokens / g.runs) },
  { label: "Cache write/run", title: "Cache-write tokens per run", value: (g) => g.cacheCreationTokens / g.runs, render: (g) => kTokens(g.cacheCreationTokens / g.runs) },
];

export function CostGroupTable({ title, groups, total }: { title: string; groups: CostGroup[]; total: number }) {
  const [sort, setSort] = useState({ column: 1, desc: true });
  const { value } = COLUMNS[sort.column];
  const sorted = [...groups].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const cmp = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return sort.desc ? -cmp : cmp;
  });

  const onHeaderClick = (column: number) =>
    setSort((s) => (s.column === column ? { column, desc: !s.desc } : { column, desc: column !== 0 }));

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.label}
                  className={`py-1 pr-3 font-medium last:pr-0 ${i === 0 ? "text-left" : "text-right"}`}
                  title={c.title}
                  aria-sort={sort.column === i ? (sort.desc ? "descending" : "ascending") : undefined}
                >
                  <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => onHeaderClick(i)}>
                    {c.label}
                    {sort.column === i && (sort.desc ? " ▼" : " ▲")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.key} className="border-t border-border">
                {COLUMNS.map((c, i) => (
                  <td
                    key={c.label}
                    className={`py-1 pr-3 last:pr-0 ${i === 0 ? "font-mono text-xs" : "text-right tabular-nums"}`}
                  >
                    {c.render(g, total)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
