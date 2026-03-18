"use client";

import type { McpConnectionStatus } from "@/types/claude";

export function ConnectionBadge({
  connectionStatus,
}: {
  connectionStatus?: McpConnectionStatus;
}) {
  if (!connectionStatus) return null;

  const { status, statusText } = connectionStatus;
  if (status === "ok") {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
        Connected
      </span>
    );
  }
  if (status === "needs_auth") {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
        Needs auth
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
        title={statusText}
      >
        Error
      </span>
    );
  }
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
      {statusText}
    </span>
  );
}
