"use client";

import { use } from "react";
import { HistoryTimeline } from "@/components/workspace/history-timeline";

export default function WorkspaceHistoryPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);

  return <HistoryTimeline workspaceName={decodedName} />;
}
