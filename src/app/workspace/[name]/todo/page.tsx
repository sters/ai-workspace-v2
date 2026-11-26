import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWorkspace } from "@/hooks/use-workspace";
import { TodoUpdater } from "@/components/workspace/todo-updater";

export default function WorkspaceTodoPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`TODO - ${name}`);
  const { workspace } = useWorkspace(name);

  if (!workspace) return null;

  return (
    <TodoUpdater
      todos={workspace.todos}
      workspacePath={workspace.path}
      workspaceName={name}
      repositories={workspace.meta.repositories}
    />
  );
}
