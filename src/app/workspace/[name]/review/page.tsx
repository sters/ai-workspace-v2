"use client";

import { use } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { ReviewViewer } from "@/components/workspace/review-viewer";

export default function WorkspaceReviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace } = useWorkspace(decodedName);

  if (!workspace) return null;

  return (
    <ReviewViewer workspaceName={decodedName} reviews={workspace.reviews} />
  );
}
