"use client";

import { use } from "react";
import { usePathname } from "next/navigation";
import { useReviews } from "@/hooks/use-workspace";
import { StatusText } from "@/components/shared/feedback/status-text";
import { ReviewFreshnessBanner } from "@/components/workspace/review-freshness-banner";
import { ReviewSessionList } from "@/components/workspace/review-session-list";

export default function ReviewLayout({
  params,
  children,
}: {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const { reviews } = useReviews(decodedName);
  const pathname = usePathname();
  const basePath = `/workspace/${name}/review`;
  const activeTimestamp = pathname.replace(basePath, "").replace(/^\//, "") || null;

  if (reviews.length === 0) {
    return <StatusText>No reviews found.</StatusText>;
  }

  return (
    <div className="space-y-4">
      {/* Above the session list, because it is about the workspace's newest
          review rather than the session being read. */}
      <ReviewFreshnessBanner workspaceName={decodedName} />
      {/* The session column is sized by its own text (`max-content`), not to a
          fixed width: every row is a fixed-length timestamp plus short counts,
          so a guessed width is either padding or a truncated label. */}
      <div className="grid gap-4 md:grid-cols-[max-content_1fr]">
        <ReviewSessionList
          reviews={reviews}
          basePath={basePath}
          activeTimestamp={activeTimestamp}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
