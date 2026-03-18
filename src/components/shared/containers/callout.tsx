import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { CalloutVariant } from "@/types/components";

const calloutStyles: Record<CalloutVariant, string> = {
  info: "rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/30",
  warning:
    "rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950",
  error: "rounded-lg border border-destructive/50 p-4",
};

export function Callout({
  variant,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { variant: CalloutVariant }) {
  return (
    <div className={cn(calloutStyles[variant], className)} {...props}>
      {children}
    </div>
  );
}
