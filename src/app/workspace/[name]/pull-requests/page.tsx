import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PullRequestsView } from "@/components/workspace/pull-requests-view";

export default function WorkspacePullRequestsPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Pull Requests - ${name}`);

  return <PullRequestsView workspaceName={name} />;
}
