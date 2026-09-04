"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReviews } from "@/hooks/use-workspace";
import { cn, formatReviewTimestamp } from "@/lib/utils";
import { StatusText } from "@/components/shared/feedback/status-text";
import { ReviewFreshnessBanner } from "@/components/workspace/review-freshness-banner";

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
      <div className="flex flex-wrap items-center gap-2">
        {reviews.map((r) => {
          const isActive = activeTimestamp === r.timestamp;
          return (
            <Link
              key={r.timestamp}
              href={`${basePath}/${r.timestamp}`}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "hover:bg-accent"
              )}
            >
              <div className="font-medium">{formatReviewTimestamp(r.timestamp)}</div>
              <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                <span>{r.repos} repos</span>
                {r.critical > 0 && (
                  <span className="text-red-500">{r.critical} critical</span>
                )}
                <span>{r.warnings} warn</span>
                <span>{r.suggestions} suggest</span>
              </div>
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
