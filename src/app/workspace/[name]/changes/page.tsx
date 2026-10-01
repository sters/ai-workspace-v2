"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ChangesBrowser } from "@/components/workspace/changes-browser";

export default function WorkspaceChangesPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Changes - ${decodedName}`);

  return <ChangesBrowser workspaceName={decodedName} />;
}
