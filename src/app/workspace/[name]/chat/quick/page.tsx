"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { QuickAsk } from "@/components/workspace/quick-ask";

export default function ChatQuickAskPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Quick Ask - ${decodedName}`);

  return <QuickAsk workspaceName={decodedName} />;
}
