"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { HistoryTimeline } from "@/components/workspace/history-timeline";

export default function WorkspaceHistoryPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`History - ${decodedName}`);

  return <HistoryTimeline workspaceName={decodedName} />;
}
