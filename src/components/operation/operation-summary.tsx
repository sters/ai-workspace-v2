"use client";

import { useEffect, useState } from "react";
import type { OperationListItem, OperationPhaseInfo } from "@/types/operation";
import { StatusBadge } from "@/components/shared/feedback/status-badge";

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PhaseExpiration({ phase, now }: { phase: OperationPhaseInfo; now: number }) {
  if (!phase.timeoutMs || !phase.startedAt) return null;

  const elapsed = now - new Date(phase.startedAt).getTime();
  const remaining = phase.timeoutMs - elapsed;
  const pct = Math.max(0, Math.min(100, (elapsed / phase.timeoutMs) * 100));
  const isExpired = remaining <= 0;
  const isWarning = !isExpired && remaining < 60_000;

  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Timeout:</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            isExpired
              ? "bg-destructive"
              : isWarning
                ? "bg-yellow-500"
                : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={
          isExpired
            ? "font-medium text-destructive"
            : isWarning
              ? "text-yellow-600"
              : "text-muted-foreground"
        }
      >
        {formatRemaining(remaining)} remaining
      </span>
    </div>
  );
}

export function OperationSummary({
  operation,
  now,
}: {
  operation: OperationListItem;
  now: number;
}) {
  const currentPhase = operation.currentPhase;
  const isAsking = operation.status === "running" && operation.hasPendingAsk;
  const displayStatus = isAsking ? "asking" : operation.status;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{operation.type}</span>
        <StatusBadge
          label={displayStatus}
          variant={`op-${displayStatus}`}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Started {new Date(operation.startedAt).toLocaleString()}
        <span className="ml-2 font-mono select-all">{operation.id}</span>
        {currentPhase && (
          <span className="ml-2">
            — Phase: {currentPhase.label}
          </span>
        )}
      </div>
      {currentPhase && <PhaseExpiration phase={currentPhase} now={now} />}
    </div>
  );
}
