import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useReadme, useWorkspace } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";
import { ReadmeUpdater } from "@/components/workspace/readme-updater";
import { OperationActions } from "@/components/workspace/operation-panel";

export default function WorkspaceOverviewPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Overview - ${name}`);
  const { readme } = useReadme(name);
  const { workspace } = useWorkspace(name);

  return (
    <div className="space-y-6">
      {workspace && (
        <>
          <OperationActions
            workspaceName={name}
            workspacePath={workspace.path}
            repositories={workspace.meta.repositories}
          />
          <ReadmeUpdater
            workspaceName={name}
            workspacePath={workspace.path}
          />
        </>
      )}
      <ReadmeViewer content={readme} />
    </div>
  );
}
