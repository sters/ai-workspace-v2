import type { ReactNode } from "react";
import { Button } from "../buttons/button";

export function PageHeader({
  title,
  description,
  onRefresh,
  refreshLabel = "Refresh",
  action,
}: {
  title: string;
  description?: ReactNode;
  onRefresh?: () => void;
  refreshLabel?: string;
  action?: ReactNode;
}) {
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {onRefresh && (
          <Button variant="outline-muted" onClick={onRefresh}>
            {refreshLabel}
          </Button>
        )}
        {action}
      </div>
      {description && (
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      )}
    </>
  );
}
