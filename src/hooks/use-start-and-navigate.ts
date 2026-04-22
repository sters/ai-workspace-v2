"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import type { OperationType } from "@/types/operation";

/**
 * Hook that starts an operation via POST and navigates to the operations page.
 * Replaces the repeated `startAndNavigate` pattern across workspace components.
 */
export function useStartAndNavigate(workspaceName: string) {
  const router = useRouter();
  const { mutate } = useSWRConfig();

  return useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("Failed to start operation:", await res.text());
        return;
      }
      const op = await res.json();
      // Invalidate operations SWR caches so the new operation appears on the target page
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/operations"),
        undefined,
        { revalidate: true },
      );
      router.push(
        `/workspace/${encodeURIComponent(workspaceName)}/operations?operationId=${encodeURIComponent(op.id)}`
      );
    },
    [router, workspaceName, mutate],
  );
}
