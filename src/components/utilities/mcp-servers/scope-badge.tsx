"use client";

import type { McpServerEntry } from "@/types/claude";

export function ScopeBadge({ scope }: { scope: McpServerEntry["scope"] }) {
  const styles = {
    user: "bg-purple-100 text-purple-700",
    project: "bg-blue-100 text-blue-700",
    local: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[scope]}`}
    >
      {scope}
    </span>
  );
}
