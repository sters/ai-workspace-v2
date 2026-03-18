"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { OperationType } from "@/types/operation";
import type { NextAction } from "@/types/components";
import { SplitButton } from "../shared/buttons/split-button";
import { Button, buttonVariants } from "../shared/buttons/button";
import { Callout } from "../shared/containers/callout";

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
  onHide,
}: {
  operationType: OperationType;
  workspace: string;
  onStart: (type: OperationType, body: Record<string, string>) => Promise<void>;
  isRunning: boolean;
  /** When true, use URL navigation (?action=) instead of calling onStart directly for Operations-tab actions. */
  useNavigation?: boolean;
  /** Called when the user clicks any next-step action to signal the parent to hide this component. */
  onHide?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const actions = getNextActions(operationType, workspace);

  if (actions.length === 0 || hidden) return null;

  const handleClick = (action: NextAction | { type: OperationType; body: Record<string, string>; primary?: boolean }) => {
    setHidden(true);
    onHide?.();
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
    <Callout variant="info">
      <p className="mb-2 text-sm font-medium text-foreground">Next steps</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          if (action.linkSubPath) {
            const basePath = pathname.split("/").slice(0, 3).join("/");
            return (
              <Link
                key={action.label}
                href={`${basePath}${action.linkSubPath}`}
                onClick={() => { setHidden(true); onHide?.(); }}
                className={buttonVariants("outline", "bg-background px-3 py-1.5 text-sm text-foreground")}
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
                variant={action.primary ? "primary" : "outline"}
                items={action.batchItems.map((bi) => ({
                  label: bi.label,
                  onClick: () => handleClick({ ...bi, primary: false }),
                }))}
              />
            );
          }
          return (
            <Button
              key={action.type}
              variant={action.primary ? "primary" : "outline"}
              className={action.primary ? undefined : "bg-background px-3 py-1.5 text-sm text-foreground"}
              onClick={() => handleClick(action)}
              disabled={isRunning}
            >
              {action.label}
            </Button>
          );
        })}
      </div>
    </Callout>
  );
}
