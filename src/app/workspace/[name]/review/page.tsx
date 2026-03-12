"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReviews } from "@/hooks/use-workspace";

export default function WorkspaceReviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { reviews } = useReviews(decodedName);
  const router = useRouter();

  useEffect(() => {
    if (reviews.length > 0) {
      router.replace(
        `/workspace/${name}/review/${reviews[0].timestamp}`
      );
    }
  }, [reviews, router, name]);

  return null;
}
