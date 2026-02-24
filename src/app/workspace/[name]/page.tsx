"use client";

import { use } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";

export default function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace } = useWorkspace(decodedName);

  if (!workspace) return null;

  return <ReadmeViewer content={workspace.readme} />;
}
