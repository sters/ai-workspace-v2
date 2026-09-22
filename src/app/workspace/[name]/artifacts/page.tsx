"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ArtifactsBrowser } from "@/components/workspace/artifacts-browser";

export default function WorkspaceArtifactsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Artifacts - ${decodedName}`);

  return <ArtifactsBrowser workspaceName={decodedName} />;
}
