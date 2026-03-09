"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";

export default function WorkspaceReviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { workspace } = useWorkspace(decodedName);
  const router = useRouter();

  useEffect(() => {
    if (workspace && workspace.reviews.length > 0) {
      router.replace(
        `/workspace/${name}/review/${workspace.reviews[0].timestamp}`
      );
    }
  }, [workspace, router, name]);

  return null;
}
