"use client";

import { use } from "react";
import { useReadme } from "@/hooks/use-workspace";
import { ReadmeViewer } from "@/components/workspace/readme-viewer";

export default function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { readme } = useReadme(decodedName);

  return <ReadmeViewer content={readme} />;
}
