"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { OperationCard } from "@/components/workspace/operation-card";
import { StatusText } from "@/components/shared/feedback/status-text";
import type { OperationListItem, OperationType } from "@/types/operation";
import { fetcher, killOperation } from "@/lib/api";
import { extractBatchParams } from "@/lib/batch-modes";

const VALID_AUTO_ACTIONS = new Set<string>([
  "execute",
  "review",
  "create-pr",
  "create-todo",
  "batch",
]);

export function OperationsList({ workspaceName }: { workspaceName: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const wsParam = encodeURIComponent(workspaceName);

  // Poll running operations: fast when active, slow when idle
  const { data: runningOps, mutate: mutateRunning } = useSWR<OperationListItem[]>(
    `/api/operations?workspace=${wsParam}&status=running`,
    fetcher,
    { refreshInterval: 10000 },
  );

  // Fetch all operations once (includes completed from disk); no polling needed
  const { data: allOps, mutate: mutateAll } = useSWR<OperationListItem[]>(
    `/api/operations?workspace=${wsParam}`,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const mutate = useCallback(() => {
    mutateRunning();
    mutateAll();
  }, [mutateRunning, mutateAll]);

  // Merge: running operations (fresh) override stale entries from allOps
  const mergedOps = (() => {
    const running = runningOps ?? [];
    const all = allOps ?? [];
    const runningIds = new Set(running.map((op) => op.id));
    // Replace stale entries with fresh running data
    const completed = all.filter((op) => !runningIds.has(op.id));
    return [...running, ...completed];
  })();

  // Sort: running first, then by start time descending
  const sortedOps = [...mergedOps].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  // Track locally-started operations so they appear immediately
  const [localOps, setLocalOps] = useState<OperationListItem[]>([]);

  // Merge local ops with server ops, deduplicating by ID
  const serverIds = new Set(sortedOps.map((op) => op.id));
  const pendingLocalOps = localOps.filter((op) => !serverIds.has(op.id));
  const displayOps = [...pendingLocalOps, ...sortedOps];

  // Auto-expand specific operation from URL
  const expandOperationId = searchParams.get("operationId");

  // Auto-action from URL
  const autoActionRef = useRef(false);
  useEffect(() => {
    if (autoActionRef.current) return;
    const action = searchParams.get("action");
    if (!action || !VALID_AUTO_ACTIONS.has(action)) return;
    autoActionRef.current = true;

    const body: Record<string, string> = { workspace: workspaceName };
    if (action === "batch") {
      Object.assign(body, extractBatchParams(searchParams));
    }

    // Clear search params
    router.replace(pathname, { scroll: false });

    // Start the operation
    fetch(`/api/operations/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((op: OperationListItem) => {
        setLocalOps((prev) => [op, ...prev]);
        mutate();
      })
      .catch((err) => console.error("Failed to start auto-action:", err));
  }, [searchParams, workspaceName, router, pathname, mutate]);

  const handleStartOperation = useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const op: OperationListItem = await res.json();
      setLocalOps((prev) => [op, ...prev]);
      mutate();
    },
    [mutate]
  );

  const handleCancel = useCallback(
    async (operationId: string) => {
      await killOperation(operationId);
      mutate();
    },
    [mutate]
  );


  if (displayOps.length === 0) {
    return (
      <StatusText>
        No operations for this workspace. Use the buttons above to start one.
      </StatusText>
    );
  }

  return (
    <div className="space-y-3">
      {displayOps.map((op) => (
        <OperationCard
          key={op.id}
          operation={op}
          onStartOperation={handleStartOperation}
          onCancel={handleCancel}
          defaultExpanded={
            op.status === "running" || op.id === expandOperationId
          }
        />
      ))}
    </div>
  );
}
