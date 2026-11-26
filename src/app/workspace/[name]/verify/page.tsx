import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { VerificationBrowser } from "@/components/workspace/verification-browser";

export default function WorkspaceVerifyPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Verify - ${name}`);

  return <VerificationBrowser workspaceName={name} />;
}
