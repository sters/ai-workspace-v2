"use client";

import { use } from "react";
import { ReviewDetail } from "@/components/workspace/review-detail";

export default function ReviewTimestampPage({
  params,
}: {
  params: Promise<{ name: string; timestamp: string }>;
}) {
  const { name, timestamp } = use(params);
  const decodedName = decodeURIComponent(name);

  return <ReviewDetail workspaceName={decodedName} timestamp={timestamp} />;
}
