import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
    />
  );
}
