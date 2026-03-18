import { StatusBadge } from "@/components/shared/feedback/status-badge";
import type { McpServerEntry } from "@/types/claude";

export function ScopeBadge({ scope }: { scope: McpServerEntry["scope"] }) {
  return <StatusBadge label={scope} variant={scope} shape="square" />;
}
