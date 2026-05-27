"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ReviewDetail } from "@/components/workspace/review-detail";

export default function ReviewTimestampPage({
  params,
}: {
  params: Promise<{ name: string; timestamp: string }>;
}) {
  const { name, timestamp } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Review ${timestamp} - ${decodedName}`);

  return <ReviewDetail workspaceName={decodedName} timestamp={timestamp} />;
}
