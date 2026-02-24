"use client";

import { use } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { TodoUpdater } from "@/components/workspace/todo-updater";

export default function WorkspaceTodoPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace } = useWorkspace(decodedName);

  if (!workspace) return null;

  return (
    <TodoUpdater
      todos={workspace.todos}
      workspacePath={workspace.path}
      workspaceName={decodedName}
    />
  );
}
