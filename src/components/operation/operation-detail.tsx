import { useCallback } from "react";
import { useRouter } from "@/lib/router/navigation";
import { OperationCard } from "@/components/workspace/operation-card";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { killOperation } from "@/lib/api";
import type { OperationListItem, OperationType } from "@/types/operation";

/** An operation that belongs to no workspace, shown on a page of its own. */
export function OperationDetail({
  operation,
  onRefresh,
}: {
  operation: OperationListItem;
  onRefresh: () => void;
}) {
  const router = useRouter();
  useDocumentTitle(`Operation: ${operation.type}`);

  const handleStartOperation = useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const started = (await res.json()) as { id: string };
      router.push(`/operations/${encodeURIComponent(started.id)}`);
    },
    [router],
  );

  const handleCancel = useCallback(
    async (operationId: string) => {
      await killOperation(operationId);
      onRefresh();
    },
    [onRefresh],
  );

  return (
    <div>
      <PageHeader
        title={operation.type}
        description={operation.workspace || undefined}
        onRefresh={onRefresh}
      />
      <OperationCard
        key={`${operation.id}:${operation.status}`}
        operation={operation}
        onStartOperation={handleStartOperation}
        onCancel={handleCancel}
        defaultExpanded
      />
    </div>
  );
}
