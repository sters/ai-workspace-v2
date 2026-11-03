import type { ClaudeRun } from "@/lib/db/claude-runs";

export interface CostGroup {
  key: string;
  costUsd: number;
  runs: number;
  durationMs: number;
  outputTokens: number;
  cacheCreationTokens: number;
}

export interface OperationCost {
  operationId: string;
  operationType: string;
  workspace: string;
  costUsd: number;
  runs: number;
  startedAt: string;
}

export interface RunCostSummary {
  totalCostUsd: number;
  runs: number;
  operations: number;
  byOperationType: CostGroup[];
  byPhase: CostGroup[];
  byStep: CostGroup[];
  byModel: CostGroup[];
  byEffort: CostGroup[];
  topOperations: OperationCost[];
}

const TOP_OPERATIONS = 20;

/**
 * Phase labels carry the cycle number, and a parallel phase is named after its
 * children (`Phase 2: review-a, verify-readme-a`); neither belongs in a key that
 * should match the same phase across runs.
 */
function phaseKey(run: ClaudeRun): string {
  const phase = (run.phaseLabel ?? "-")
    .replace(/^Cycle \d+/, "Cycle N")
    .replace(/^(Phase \d+): .*$/, "$1");
  return `${run.operationType} / ${phase}`;
}

function groupBy(runs: ClaudeRun[], key: (r: ClaudeRun) => string): CostGroup[] {
  const groups = new Map<string, CostGroup>();
  for (const r of runs) {
    const k = key(r);
    const g = groups.get(k) ?? { key: k, costUsd: 0, runs: 0, durationMs: 0, outputTokens: 0, cacheCreationTokens: 0 };
    g.costUsd += r.costUsd;
    g.runs += 1;
    g.durationMs += r.durationMs;
    g.outputTokens += r.outputTokens;
    g.cacheCreationTokens += r.cacheCreationTokens;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function summarizeClaudeRuns(runs: ClaudeRun[]): RunCostSummary {
  const ops = new Map<string, OperationCost>();
  for (const r of runs) {
    const op = ops.get(r.operationId) ?? {
      operationId: r.operationId,
      operationType: r.operationType,
      workspace: r.workspace,
      costUsd: 0,
      runs: 0,
      startedAt: r.createdAt,
    };
    op.costUsd += r.costUsd;
    op.runs += 1;
    if (r.createdAt < op.startedAt) op.startedAt = r.createdAt;
    ops.set(r.operationId, op);
  }

  return {
    totalCostUsd: runs.reduce((n, r) => n + r.costUsd, 0),
    runs: runs.length,
    operations: ops.size,
    byOperationType: groupBy(runs, (r) => r.operationType),
    byPhase: groupBy(runs, phaseKey),
    byStep: groupBy(runs, (r) => r.stepType ?? `(phase) ${phaseKey(r)}`),
    byModel: groupBy(runs, (r) => r.model ?? "(unknown)"),
    byEffort: groupBy(runs, (r) => r.effort ?? "(unrecorded)"),
    topOperations: [...ops.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_OPERATIONS),
  };
}
