"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useResearchReport } from "@/hooks/use-workspace";
import { ResearchViewer } from "@/components/workspace/research-viewer";

export default function WorkspaceResearchPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Research - ${decodedName}`);
  const { summary, files } = useResearchReport(decodedName);

  return <ResearchViewer workspaceName={decodedName} summary={summary} files={files} />;
}
