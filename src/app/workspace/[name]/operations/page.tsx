import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OperationsList } from "@/components/workspace/operations-list";

export default function OperationsPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Operations - ${name}`);

  return <OperationsList workspaceName={name} />;
}
