"use client";

import { use } from "react";
import { useResearchReport } from "@/hooks/use-workspace";
import { ResearchViewer } from "@/components/workspace/research-viewer";

export default function WorkspaceResearchPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { summary, files } = useResearchReport(decodedName);

  return <ResearchViewer workspaceName={decodedName} summary={summary} files={files} />;
}
