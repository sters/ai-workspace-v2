import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ChangesBrowser } from "@/components/workspace/changes-browser";

export default function WorkspaceChangesPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Changes - ${name}`);

  return <ChangesBrowser workspaceName={name} />;
}
