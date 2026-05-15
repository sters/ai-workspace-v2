"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { OperationCard } from "@/components/workspace/operation-card";
import { Button } from "@/components/shared/buttons/button";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher, killOperation } from "@/lib/api";
import type { OperationListItem, OperationType } from "@/types/operation";

const PAGE_SIZE = 10;

export function NewOperationsHistory() {
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, error, isLoading, mutate } = useSWR<OperationListItem[]>(
    `/api/operations/new-history?limit=${limit}`,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
  );

  const handleStartOperation = useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      mutate();
    },
    [mutate],
  );

  const handleCancel = useCallback(
    async (operationId: string) => {
      await killOperation(operationId);
      mutate();
    },
    [mutate],
  );

  const items = data ?? [];
  const hasMore = items.length >= limit;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Recent New Operations</h2>
      {error && (
        <StatusText variant="error">Failed to load history.</StatusText>
      )}
      {!error && items.length === 0 && (
        <StatusText>
          {isLoading ? "Loading..." : "No past new operations yet."}
        </StatusText>
      )}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((op) => (
            <OperationCard
              key={op.id}
              operation={op}
              onStartOperation={handleStartOperation}
              onCancel={handleCancel}
              defaultExpanded={false}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline-muted"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
          >
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
