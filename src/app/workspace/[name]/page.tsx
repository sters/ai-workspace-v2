"use client";

import { Suspense, use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";
import { TodoUpdater } from "@/components/workspace/todo-updater";
import { ReviewViewer } from "@/components/workspace/review-viewer";
import { HistoryTimeline } from "@/components/workspace/history-timeline";
import { OperationPanel } from "@/components/workspace/operation-panel";
import { ProgressBar } from "@/components/shared/progress-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { OperationType } from "@/types/operation";

const TABS = ["Overview", "TODOs", "Reviews", "History", "Operations"] as const;
type Tab = (typeof TABS)[number];

const VALID_AUTO_ACTIONS = new Set<string>(["execute", "review", "create-pr"]);

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  return (
    <Suspense fallback={<div className="animate-pulse space-y-4"><div className="h-8 w-1/3 rounded bg-muted" /><div className="h-64 rounded bg-muted" /></div>}>
      <WorkspaceDetailContent params={params} />
    </Suspense>
  );
}

function WorkspaceDetailContent({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace, isLoading } = useWorkspace(decodedName);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [autoAction, setAutoAction] = useState<OperationType | undefined>();

  // Parse ?action= param and switch to Operations tab
  useEffect(() => {
    const action = searchParams.get("action");
    if (action && VALID_AUTO_ACTIONS.has(action)) {
      setActiveTab("Operations");
      setAutoAction(action as OperationType);
      // Clear the query param from URL without full navigation
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  const handleAutoActionConsumed = useCallback(() => {
    setAutoAction(undefined);
  }, []);

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-1/3 rounded bg-muted" />
      <div className="h-64 rounded bg-muted" />
    </div>;
  }

  if (!workspace) {
    return (
      <div>
        <p className="mb-4 text-muted-foreground">Workspace not found.</p>
        <Link href="/" className="text-sm underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

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

      {/* Tabs */}
      <div className="mb-4 flex border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "Overview" && (
          <ReadmeViewer content={workspace.readme} />
        )}
        {activeTab === "TODOs" && (
          <TodoUpdater
            todos={workspace.todos}
            workspacePath={workspace.path}
            workspaceName={decodedName}
          />
        )}
        {activeTab === "Reviews" && (
          <ReviewViewer
            workspaceName={decodedName}
            reviews={workspace.reviews}
          />
        )}
        {activeTab === "History" && (
          <HistoryTimeline workspaceName={decodedName} />
        )}
        {activeTab === "Operations" && (
          <OperationPanel
            workspacePath={workspace.path}
            autoAction={autoAction}
            onAutoActionConsumed={handleAutoActionConsumed}
          />
        )}
      </div>
    </div>
  );
}
