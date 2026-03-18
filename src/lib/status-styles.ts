/**
 * Shared status color/icon maps used across operation log components.
 *
 * Text colors for inline status indicators (icons, labels).
 */
export const statusTextColors: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  completed: "text-green-600",
  failed: "text-red-500",
  stopped: "text-yellow-600",
  skipped: "text-muted-foreground/50",
};

/** Unicode status icons. */
export const statusIcons: Record<string, string> = {
  pending: "\u25CB",   // ○
  running: "\u25CF",   // ●
  completed: "\u2713", // ✓
  failed: "\u2717",    // ✗
  stopped: "\u25A0",   // ■
  skipped: "\u2014",   // —
};

/** Badge-style colors (background + text, light and dark). */
export const statusBadgeColors: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  asking: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
};
