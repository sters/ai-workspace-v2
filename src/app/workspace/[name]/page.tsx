"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useReadme } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";

export default function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Overview - ${decodedName}`);
  const { readme } = useReadme(decodedName);

  return <ReadmeViewer content={readme} />;
}
