"use client";

import { Suspense, use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { ProgressBar } from "@/components/shared/progress-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { OperationPanel } from "@/components/workspace/operation-panel";
import { cn } from "@/lib/utils";
import type { OperationType } from "@/types/operation";

const TABS = [
  { label: "Overview", segment: "" },
  { label: "TODOs", segment: "todo" },
  { label: "Reviews", segment: "review" },
  { label: "History", segment: "history" },
  { label: "Chat", segment: "chat" },
] as const;

const VALID_AUTO_ACTIONS = new Set<string>(["execute", "review", "create-pr", "create-todo", "batch"]);

export default function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-1/3 rounded bg-muted" />
          <div className="h-64 rounded bg-muted" />
        </div>
      }
    >
      <WorkspaceLayoutContent params={params}>
        {children}
      </WorkspaceLayoutContent>
    </Suspense>
  );
}

function WorkspaceLayoutContent({
  params,
  children,
}: {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace, isLoading, error } = useWorkspace(decodedName);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [autoAction, setAutoAction] = useState<OperationType | undefined>();
  const [autoActionExtra, setAutoActionExtra] = useState<Record<string, string> | undefined>();
  const [initialOperationId, setInitialOperationId] = useState<string | undefined>();

  // Parse ?action= and ?operationId= search params
  useEffect(() => {
    const action = searchParams.get("action");
    const opId = searchParams.get("operationId");

    if (opId) {
      setInitialOperationId(opId);
      router.replace(pathname, { scroll: false });
    } else if (action && VALID_AUTO_ACTIONS.has(action)) {
      setAutoAction(action as OperationType);
      if (action === "batch") {
        const extra: Record<string, string> = {};
        for (const key of ["startWith", "mode", "instruction", "draft"]) {
          const val = searchParams.get(key);
          if (val) extra[key] = val;
        }
        setAutoActionExtra(extra);
      }
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  const handleAutoActionConsumed = useCallback(() => {
    setAutoAction(undefined);
    setAutoActionExtra(undefined);
  }, []);

  // Redirect to dashboard when workspace disappears (e.g. after deletion)
  useEffect(() => {
    if (!isLoading && (!workspace || error)) {
      router.replace("/");
    }
  }, [isLoading, workspace, error, router]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-1/3 rounded bg-muted" />
        <div className="h-64 rounded bg-muted" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div>
        <p className="mb-4 text-muted-foreground">
          Workspace not found. Redirecting…
        </p>
      </div>
    );
  }

  const basePath = `/workspace/${name}`;
  // Extract the segment after /workspace/[name]/
  const segments = pathname.replace(basePath, "").replace(/^\//, "");
  const activeSegment = segments.split("/")[0] || "";

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link
          href="/"
          className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{workspace.meta.title}</h1>
            <p className="text-sm text-muted-foreground">{decodedName}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge label={workspace.meta.taskType} />
            {workspace.meta.ticketId && (
              <span className="text-sm text-muted-foreground">
                {workspace.meta.ticketId}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress summary */}
      <div className="mb-6 rounded-lg border p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>
            Overall Progress: {workspace.totalCompleted}/{workspace.totalItems}{" "}
            items
          </span>
          <span className="text-muted-foreground">
            {workspace.meta.repositories.length} repositories
          </span>
        </div>
        <ProgressBar value={workspace.overallProgress} />
      </div>

      {/* Operations */}
      <div className="mb-6">
        <OperationPanel
          workspacePath={workspace.path}
          repositories={workspace.meta.repositories}
          autoAction={autoAction}
          autoActionExtra={autoActionExtra}
          onAutoActionConsumed={handleAutoActionConsumed}
          initialOperationId={initialOperationId}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex border-b">
        {TABS.map((tab) => {
          const href =
            tab.segment === "" ? basePath : `${basePath}/${tab.segment}`;
          const isActive = activeSegment === tab.segment;
          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>{children}</div>
    </div>
  );
}
