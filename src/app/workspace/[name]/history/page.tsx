import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { HistoryTimeline } from "@/components/workspace/history-timeline";

export default function WorkspaceHistoryPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`History - ${name}`);

  return <HistoryTimeline workspaceName={name} />;
}
