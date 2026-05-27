"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWorkspace } from "@/hooks/use-workspace";
import { MemoEditor } from "@/components/workspace/memo-editor";

export default function WorkspaceMemoPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Memo - ${decodedName}`);
  const { workspace } = useWorkspace(decodedName);

  if (!workspace) return null;

  return (
    <MemoEditor
      workspaceName={decodedName}
      workspacePath={workspace.path}
    />
  );
}
