import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWorkspace } from "@/hooks/use-workspace";
import { MemoEditor } from "@/components/workspace/memo-editor";

export default function WorkspaceMemoPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Memo - ${name}`);
  const { workspace } = useWorkspace(name);

  if (!workspace) return null;

  return (
    <MemoEditor
      workspaceName={name}
      workspacePath={workspace.path}
    />
  );
}
