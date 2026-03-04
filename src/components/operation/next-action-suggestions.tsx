"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { OperationType } from "@/types/operation";
import { SplitButton } from "../shared/split-button";

interface NextAction {
  label: string;
  type: OperationType;
  body: Record<string, string>;
  primary?: boolean;
  /** Batch dropdown items for this action. */
  batchItems?: { label: string; type: OperationType; body: Record<string, string> }[];
  /** When set, renders as a link navigating to this sub-path (e.g. "/review") instead of triggering an operation. */
  linkSubPath?: string;
}

function executeBatchItems(workspace: string): NextAction["batchItems"] {
  return [
    {
      label: "Execute \u2192 Review",
      type: "batch",
      body: { startWith: "execute", mode: "execute-review", workspace },
    },
    {
      label: "Execute \u2192 PR",
      type: "batch",
      body: { startWith: "execute", mode: "execute-pr", workspace },
    },
    {
      label: "Execute \u2192 Review \u2192 PR (gated)",
      type: "batch",
      body: { startWith: "execute", mode: "execute-review-pr-gated", workspace },
    },
    {
      label: "Execute \u2192 Review \u2192 PR",
      type: "batch",
      body: { startWith: "execute", mode: "execute-review-pr", workspace },
    },
  ];
}

function getNextActions(
  completedType: OperationType,
  workspace: string
): NextAction[] {
  switch (completedType) {
    case "init":
      return [
        {
          label: "Execute",
          type: "execute",
          body: { workspace },
          primary: true,
          batchItems: executeBatchItems(workspace),
        },
      ];
    case "execute":
      return [
        {
          label: "Review Changes",
          type: "review",
          body: { workspace },
          primary: true,
        },
      ];
    case "review":
      return [
        {
          label: "View Review",
          type: "review",
          body: { workspace },
          linkSubPath: "/review",
        },
        {
          label: "Create PR",
          type: "create-pr",
          body: { workspace },
          primary: true,
        },
        {
          label: "Execute",
          type: "execute",
          body: { workspace },
          batchItems: executeBatchItems(workspace),
        },
      ];
    case "update-todo":
    case "create-todo":
      return [
        {
          label: "Execute",
          type: "execute",
          body: { workspace },
          primary: true,
          batchItems: executeBatchItems(workspace),
        },
      ];
    case "create-pr":
    case "batch":
      // Terminal operations
      return [];
    default:
      return [];
  }
}

/** Actions that should run in the Operations tab (not inline). */
const OPERATIONS_TAB_ACTIONS = new Set<OperationType>([
  "execute",
  "review",
  "create-pr",
  "batch",
]);

export function NextActionSuggestions({
  operationType,
  workspace,
  onStart,
  isRunning,
  useNavigation,
}: {
  operationType: OperationType;
  workspace: string;
  onStart: (type: OperationType, body: Record<string, string>) => Promise<void>;
  isRunning: boolean;
  /** When true, use URL navigation (?action=) instead of calling onStart directly for Operations-tab actions. */
  useNavigation?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const actions = getNextActions(operationType, workspace);

  if (actions.length === 0 || hidden) return null;

  const handleClick = (action: NextAction | { type: OperationType; body: Record<string, string>; primary?: boolean }) => {
    setHidden(true);
    if (useNavigation && OPERATIONS_TAB_ACTIONS.has(action.type)) {
      // Navigate to the operations sub-route with ?action= to auto-trigger
      // pathname may be /workspace/[name] or /workspace/[name]/todo etc.
      const basePath = pathname.split("/").slice(0, 3).join("/");
      const params = new URLSearchParams({ action: action.type });
      // For batch actions, include extra params in the URL
      if (action.type === "batch") {
        for (const [key, val] of Object.entries(action.body)) {
          if (key !== "workspace") params.set(key, val);
        }
      }
      router.push(`${basePath}/operations?${params.toString()}`);
    } else {
      onStart(action.type, action.body);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
      <p className="mb-2 text-sm font-medium text-foreground">Next steps</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          if (action.linkSubPath) {
            const basePath = pathname.split("/").slice(0, 3).join("/");
            return (
              <Link
                key={action.label}
                href={`${basePath}${action.linkSubPath}`}
                className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
              >
                {action.label}
              </Link>
            );
          }
          if (action.batchItems) {
            return (
              <SplitButton
                key={action.type}
                label={action.label}
                onClick={() => handleClick(action)}
                disabled={isRunning}
                className={
                  action.primary
                    ? "rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    : "rounded-l-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                }
                items={action.batchItems.map((bi) => ({
                  label: bi.label,
                  onClick: () => handleClick({ ...bi, primary: false }),
                }))}
              />
            );
          }
          return (
            <button
              key={action.type}
              onClick={() => handleClick(action)}
              disabled={isRunning}
              className={
                action.primary
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  : "rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              }
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
