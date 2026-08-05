"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PullRequestsView } from "@/components/workspace/pull-requests-view";

export default function WorkspacePullRequestsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Pull Requests - ${decodedName}`);

  return <PullRequestsView workspaceName={decodedName} />;
}
