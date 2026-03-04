import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusText({
  variant = "muted",
  className,
  children,
}: {
  variant?: "muted" | "error";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-sm",
        variant === "error" ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {children}
    </p>
  );
}
