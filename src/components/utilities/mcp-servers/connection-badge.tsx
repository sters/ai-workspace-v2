"use client";

import { StatusBadge } from "@/components/shared/feedback/status-badge";
import type { McpConnectionStatus } from "@/types/claude";

const statusMap: Record<string, { label: string; variant: string }> = {
  ok: { label: "Connected", variant: "connected" },
  needs_auth: { label: "Needs auth", variant: "needs-auth" },
  error: { label: "Error", variant: "error" },
};

export function ConnectionBadge({
  connectionStatus,
}: {
  connectionStatus?: McpConnectionStatus;
}) {
  if (!connectionStatus) return null;

  const { status, statusText } = connectionStatus;
  const mapped = statusMap[status];

  if (mapped) {
    return (
      <StatusBadge
        label={mapped.label}
        variant={mapped.variant}
        shape="square"
        title={status === "error" ? statusText : undefined}
      />
    );
  }

  return (
    <StatusBadge label={statusText} variant="unknown" shape="square" />
  );
}
