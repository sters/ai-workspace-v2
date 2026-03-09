"use client";

import { use } from "react";
import { QuickAsk } from "@/components/workspace/quick-ask";

export default function ChatQuickAskPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);

  return <QuickAsk workspaceName={decodedName} />;
}
