"use client";

import { type ReactNode, useCallback, useState } from "react";
import { Button } from "@/components/shared/buttons/button";

/**
 * Collapsible section with a toggle header.
 * Mirrors the HistoryTimeline expand/collapse pattern:
 * Button ghost-toggle, ▲/▼ arrows, hover:bg-muted/50 transition.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div>
      <Button
        variant="ghost-toggle"
        type="button"
        className="flex w-full cursor-pointer gap-3 text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
        onClick={toggle}
      >
        <span className="flex-1 text-sm">
          {title}
          {badge != null && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        <span className="text-xs self-center">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </Button>
      {expanded && <div className="mt-1">{children}</div>}
    </div>
  );
}
