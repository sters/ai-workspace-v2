"use client";

import { use, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { OperationCard } from "@/components/workspace/operation-card";
import type { OperationListItem, OperationType } from "@/types/operation";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const VALID_AUTO_ACTIONS = new Set<string>([
  "execute",
  "review",
  "create-pr",
  "create-todo",
  "batch",
]);

export default function OperationsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Poll operation summaries filtered by this workspace
  const { data, mutate } = useSWR<OperationListItem[]>(
    `/api/operations?workspace=${encodeURIComponent(decodedName)}`,
    fetcher,
    { refreshInterval: 3000 }
  );

  const workspaceOps = data ?? [];

  // Sort: running first, then by start time descending
  const sortedOps = [...workspaceOps].sort((a, b) => {
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

    const body: Record<string, string> = { workspace: decodedName };
    if (action === "batch") {
      for (const key of ["startWith", "mode", "instruction", "draft"]) {
        const val = searchParams.get(key);
        if (val) body[key] = val;
      }
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
  }, [searchParams, decodedName, router, pathname, mutate]);

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
      await fetch("/api/operations/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      mutate();
    },
    [mutate]
  );

  const handleClear = useCallback(
    async (operationId: string) => {
      await fetch("/api/operations/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      setLocalOps((prev) => prev.filter((op) => op.id !== operationId));
      mutate();
    },
    [mutate]
  );

  if (displayOps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No operations for this workspace. Use the buttons above to start one.
      </p>
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
          onClear={handleClear}
          defaultExpanded={
            op.status === "running" || op.id === expandOperationId
          }
        />
      ))}
    </div>
  );
}
