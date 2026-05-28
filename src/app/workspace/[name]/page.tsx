"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useReadme, useWorkspace } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";
import { ReadmeUpdater } from "@/components/workspace/readme-updater";

export default function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Overview - ${decodedName}`);
  const { readme } = useReadme(decodedName);
  const { workspace } = useWorkspace(decodedName);

  return (
    <div className="space-y-6">
      <ReadmeViewer content={readme} />
      {workspace && (
        <ReadmeUpdater
          workspaceName={decodedName}
          workspacePath={workspace.path}
        />
      )}
    </div>
  );
}
