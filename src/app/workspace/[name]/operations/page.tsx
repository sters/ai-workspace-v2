"use client";

import { use } from "react";
import { OperationsList } from "@/components/workspace/operations-list";

export default function OperationsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);

  return <OperationsList workspaceName={decodedName} />;
}
