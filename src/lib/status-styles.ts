/**
 * Shared status color/icon maps used across operation log components.
 *
 * Text colors for inline status indicators (icons, labels).
 */
export type StatusKey = "pending" | "running" | "completed" | "failed" | "stopped" | "skipped" | "retrying";

export const statusTextColors: Record<StatusKey, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  completed: "text-green-600",
  failed: "text-red-500",
  stopped: "text-yellow-600",
  skipped: "text-muted-foreground/50",
  retrying: "text-orange-500",
};

/** Unicode status icons. */
export const statusIcons: Record<StatusKey, string> = {
  pending: "\u25CB",   // ○
  running: "\u25CF",   // ●
  completed: "\u2713", // ✓
  failed: "\u2717",    // ✗
  stopped: "\u25A0",   // ■
  skipped: "\u2014",   // —
  retrying: "\u21BA",  // ↺
};

