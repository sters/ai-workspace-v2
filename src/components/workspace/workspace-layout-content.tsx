"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { Card } from "@/components/shared/containers/card";
import { ProgressBar } from "@/components/shared/feedback/progress-bar";
import { StatusBadge } from "@/components/shared/feedback/status-badge";
import { OperationPanel } from "@/components/workspace/operation-panel";
import { cn } from "@/lib/utils";
import { extractBatchParams } from "@/lib/batch-modes";

const TABS = [
  { label: "Overview", segment: "", href: "" },
  { label: "TODOs", segment: "todo", href: "todo" },
  { label: "Reviews", segment: "review", href: "review" },
  { label: "History", segment: "history", href: "history" },
  { label: "Operations", segment: "operations", href: "operations" },
  { label: "Chat", segment: "chat", href: "chat/quick" },
] as const;

const VALID_AUTO_ACTIONS = new Set<string>(["execute", "review", "create-pr", "create-todo", "batch"]);

export function WorkspaceLayoutContent({
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

  // Redirect ?action= and ?operationId= to the Operations tab
  useEffect(() => {
    const action = searchParams.get("action");
    const opId = searchParams.get("operationId");
    const isOnOperations = pathname.endsWith("/operations");

    if (opId && !isOnOperations) {
      router.replace(`/workspace/${name}/operations?operationId=${encodeURIComponent(opId)}`, { scroll: false });
    } else if (action && VALID_AUTO_ACTIONS.has(action) && !isOnOperations) {
      const params = new URLSearchParams({ action });
      if (action === "batch") {
        Object.entries(extractBatchParams(searchParams)).forEach(([k, v]) => params.set(k, v));
      }
      router.replace(`/workspace/${name}/operations?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router, name, pathname]);

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
      <Card className="mb-6">
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
      </Card>

      {/* Operations */}
      <div className="mb-6">
        <OperationPanel
          workspaceName={decodedName}
          workspacePath={workspace.path}
          repositories={workspace.meta.repositories}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex border-b">
        {TABS.map((tab) => {
          const href =
            tab.href === "" ? basePath : `${basePath}/${tab.href}`;
          const isActive = tab.segment === ""
            ? activeSegment === ""
            : activeSegment === tab.segment;
          const cls = cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            isActive
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          );
          return isActive ? (
            <span key={tab.segment} className={cls}>
              {tab.label}
            </span>
          ) : (
            <Link key={tab.segment} href={href} className={cls}>
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
