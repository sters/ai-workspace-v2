import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  feature: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  bugfix: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  research:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  investigation:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  documentation:
    "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  unknown: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  running:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  asking:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  // Scope variants (MCP servers)
  user: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  project: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  local: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  // Connection variants (MCP servers)
  connected:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  "needs-auth": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  // Operation status
  "op-running":
    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "op-completed":
    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  "op-failed":
    "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "op-asking":
    "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  // Muted variant (config editor "not found")
  muted: "bg-muted text-muted-foreground",
};

const shapes = {
  pill: "rounded-full px-2.5",
  square: "rounded px-1.5",
};

export function StatusBadge({
  label,
  variant,
  shape = "pill",
  title,
  className,
}: {
  label: string;
  variant?: string;
  shape?: "pill" | "square";
  title?: string;
  className?: string;
}) {
  const v = variant ?? label.toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center py-0.5 text-xs font-medium",
        shapes[shape],
        variants[v] ?? variants.unknown,
        className
      )}
      title={title}
    >
      {label}
    </span>
  );
}
