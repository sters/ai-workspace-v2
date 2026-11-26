import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ArtifactsBrowser } from "@/components/workspace/artifacts-browser";

export default function WorkspaceArtifactsPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Artifacts - ${name}`);

  return <ArtifactsBrowser workspaceName={name} />;
}
