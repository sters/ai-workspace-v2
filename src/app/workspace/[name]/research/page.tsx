import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useResearchReport } from "@/hooks/use-workspace";
import { ResearchViewer } from "@/components/workspace/research-viewer";

export default function WorkspaceResearchPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Research - ${name}`);
  const { summary, files } = useResearchReport(name);

  return <ResearchViewer workspaceName={name} summary={summary} files={files} />;
}
