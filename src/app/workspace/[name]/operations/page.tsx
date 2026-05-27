"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OperationsList } from "@/components/workspace/operations-list";

export default function OperationsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Operations - ${decodedName}`);

  return <OperationsList workspaceName={decodedName} />;
}
