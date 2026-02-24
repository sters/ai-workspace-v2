"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { OperationPanel } from "@/components/workspace/operation-panel";
import type { OperationType } from "@/types/operation";

const VALID_AUTO_ACTIONS = new Set<string>(["execute", "review", "create-pr"]);

export default function WorkspaceOperationsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace } = useWorkspace(decodedName);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [autoAction, setAutoAction] = useState<OperationType | undefined>();

  // Parse ?action= param and auto-trigger
  useEffect(() => {
    const action = searchParams.get("action");
    if (action && VALID_AUTO_ACTIONS.has(action)) {
      setAutoAction(action as OperationType);
      // Clear the query param from URL without full navigation
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  const handleAutoActionConsumed = useCallback(() => {
    setAutoAction(undefined);
  }, []);

  if (!workspace) return null;

  return (
    <OperationPanel
      workspacePath={workspace.path}
      autoAction={autoAction}
      onAutoActionConsumed={handleAutoActionConsumed}
    />
  );
}
